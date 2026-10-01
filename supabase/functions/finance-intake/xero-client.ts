/**
 * Xero API transport concerns: rate limiting, static-data caching, and invoice
 * number collision recovery.
 *
 * These are separated from the posting logic in index.ts because they are the
 * parts that fail for reasons unrelated to whether an invoice is correct. A 429
 * is not a validation failure and must not be reported to the user as one, and a
 * cached Chart of Accounts is not a stale read if it is refreshed daily.
 */

import { mapWithConcurrency } from "./audit.ts";

/** Xero's documented limits for a paid app connection. */
export const XERO_MAX_CONCURRENT = 5;
export const XERO_MAX_PER_MINUTE = 60;

/** Maximum records in one Xero POST payload. */
export const XERO_BATCH_SIZE = 50;

export const XERO_CACHE_TTL_HOURS = 24;

/** Resources that change rarely enough to cache for a day. */
export type CacheableXeroResource = "accounts" | "taxRates" | "trackingCategories";

const CACHE_TTL_MS = XERO_CACHE_TTL_HOURS * 60 * 60 * 1000;

interface RateLimiterState {
  /** Timestamps of requests started within the last minute. */
  recent: number[];
  active: number;
}

function createLimiterState(): RateLimiterState {
  return { recent: [], active: 0 };
}

/** How long a blocked caller sleeps before re-checking, at most. */
const LIMITER_POLL_MS = 250;

/**
 * A sliding-window limiter honouring both Xero limits at once.
 *
 * Xero enforces a concurrency ceiling and a per-minute request ceiling. The
 * concurrency slot is released as soon as the response arrives, while the minute
 * window is stamped at request start, which is the stricter reading and the one
 * that keeps a burst of short requests inside the quota.
 */
export class XeroRateLimiter {
  private state: RateLimiterState = createLimiterState();

  private prune(now: number): void {
    const cutoff = now - 60_000;
    while (this.state.recent.length > 0 && this.state.recent[0] <= cutoff) {
      this.state.recent.shift();
    }
  }

  private release(): void {
    if (this.state.active > 0) this.state.active -= 1;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Blocks until a concurrency slot and a minute-window slot are both free.
   *
   * Re-checks on a short timer rather than queueing on a waiter list. A waiter
   * list has to be woken by whichever caller happens to release next, which is
   * exactly the bookkeeping that deadlocks when a request is abandoned; polling
   * costs at most LIMITER_POLL_MS of latency on a free slot and cannot hang.
   */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.prune(now);

      if (this.state.active < XERO_MAX_CONCURRENT && this.state.recent.length < XERO_MAX_PER_MINUTE) {
        this.state.active += 1;
        this.state.recent.push(now);
        return;
      }

      // Sleep until either a slot frees (bounded poll) or the minute window rolls over.
      const oldest = this.state.recent[0] ?? now;
      const untilWindowRolls = oldest + 60_000 - now;
      await this.wait(Math.max(10, Math.min(untilWindowRolls, LIMITER_POLL_MS)));
    }
  }

  releaseSlot(): void {
    this.release();
  }

  snapshot(): { active: number; lastMinute: number } {
    this.prune(Date.now());
    return { active: this.state.active, lastMinute: this.state.recent.length };
  }
}

export const xeroRateLimiter = new XeroRateLimiter();

/**
 * Runs a fetch through the shared limiter and retries 429/5xx with backoff.
 *
 * Xero signals throttling with a 429 and a Retry-After header. Honouring it is
 * the difference between a batch that slows down and one that fails outright.
 */
export async function xeroFetch(
  input: string,
  init: RequestInit & { limiter?: XeroRateLimiter; maxAttempts?: number } = {},
): Promise<Response> {
  const { limiter = xeroRateLimiter, maxAttempts = 3, ...requestInit } = init;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await limiter.acquire();
    try {
      const response = await fetch(input, requestInit);
      limiter.releaseSlot();

      if (response.status === 429 || response.status >= 500) {
        lastResponse = response;
        const retryAfter = Number(response.headers.get("Retry-After") ?? 0);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, backoff));
          continue;
        }
        return response;
      }

      return response;
    } catch (error) {
      limiter.releaseSlot();
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 500));
        continue;
      }
    }
  }

  if (lastError) throw lastError;
  if (lastResponse) return lastResponse;
  throw new Error("Xero request failed without a response");
}

// ---------------------------------------------------------------------------
// Static data cache
// ---------------------------------------------------------------------------

interface CacheClient {
  from(table: string): any;
}

export interface CachedResourceResult<T> {
  data: T;
  fromCache: boolean;
  fetchedAt: string | null;
}

function cacheKey(tenantId: string, resource: CacheableXeroResource): string {
  return `${tenantId}:${resource}`;
}

/**
 * Reads a static Xero resource through a 24-hour database-backed cache.
 *
 * The cache lives in Postgres rather than in module scope so it survives an edge
 * function cold start. A cache miss costs one outbound call per resource per
 * day instead of one per candidate, which is the actual cost driver: the
 * previous code re-fetched the full contact list once per invoice in a batch.
 */
export async function getCachedXeroResource<T>(
  supabase: CacheClient | null,
  params: {
    tenantId: string;
    resource: CacheableXeroResource;
    fetcher: () => Promise<T[]>;
    now?: number;
  },
): Promise<CachedResourceResult<T[]>> {
  const { tenantId, resource, fetcher } = params;
  const now = params.now ?? Date.now();
  const key = cacheKey(tenantId, resource);

  if (supabase) {
    try {
      const { data } = await supabase
        .from("finance_xero_cache")
        .select("payload, fetched_at, expires_at")
        .eq("cache_key", key)
        .maybeSingle();

      const expiresAt = data?.expires_at ? new Date(data.expires_at).getTime() : 0;
      if (data && expiresAt > now) {
        return {
          data: (Array.isArray(data.payload) ? data.payload : []) as T[],
          fromCache: true,
          fetchedAt: data.fetched_at ?? null,
        };
      }
    } catch (error) {
      console.warn(`[xero-cache] Read failed for ${key}:`, error instanceof Error ? error.message : String(error));
    }
  }

  const fresh = await fetcher();

  if (supabase) {
    try {
      await supabase.from("finance_xero_cache").upsert(
        {
          cache_key: key,
          tenant_id: tenantId,
          resource,
          payload: fresh,
          fetched_at: new Date(now).toISOString(),
          expires_at: new Date(now + CACHE_TTL_MS).toISOString(),
        },
        { onConflict: "cache_key" },
      );
    } catch (error) {
      // A failed cache write only costs an extra outbound call next time.
      console.warn(`[xero-cache] Write failed for ${key}:`, error instanceof Error ? error.message : String(error));
    }
  }

  return { data: fresh, fromCache: false, fetchedAt: new Date(now).toISOString() };
}

/** Drops expired cache rows. Safe to call opportunistically. */
export async function purgeExpiredXeroCache(supabase: CacheClient | null): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("finance_xero_cache").delete().lt("expires_at", new Date().toISOString());
  } catch {
    // Housekeeping only; a failure here is not worth surfacing.
  }
}

// ---------------------------------------------------------------------------
// Invoice number collision recovery
// ---------------------------------------------------------------------------

/** Xero's error code for an invoice number that is already in use. */
export const XERO_NUMBER_EXISTS_CODE = "ERROR-INVOICE-NUMBER-EXISTS";

/**
 * Detects a number collision from a Xero error body.
 *
 * Xero reports this two ways depending on endpoint and payload: an
 * `Elements[].ValidationErrors[].ErrorNumber`, and a plain message string. Both
 * are checked because relying on the structured form alone silently misses the
 * cases where Xero downgrades the error to a generic 400.
 */
export function isInvoiceNumberCollision(errorBody: string): boolean {
  if (!errorBody) return false;
  if (errorBody.includes(XERO_NUMBER_EXISTS_CODE)) return true;
  // Xero puts the offending number between the label and the predicate
  // ("Invoice number 1001 is already in use"), so the identifier is skipped.
  return /invoice\s*number\s+\S+\s+(?:is\s+)?(?:already\s+)?(?:in\s+use|exists|has\s+already\s+been\s+used)/i.test(
    errorBody,
  ) || /invoice\s*number\s+already\s+(?:exists|in\s+use)/i.test(errorBody);
}

function escapeInvoiceNumberForXero(value: string): string {
  return value.replace(/["\\]/g, "").trim();
}

/**
 * Produces a replacement invoice number when the original is permanently
 * consumed by a voided or deleted bill.
 *
 * Xero never releases an invoice number, so the original identifier cannot be
 * reused. The supplier's original is also carried in the `Reference` field by
 * the caller, so this value only has to be unique and legal.
 *
 * The original is never truncated to make room: Xero caps InvoiceNumber at 20
 * characters, and silently cutting the supplier's own number would leave a
 * ledger row whose identifier matches no document anyone holds. Instead the
 * suffix is shortened until the whole original fits, and if even the shortest
 * suffix leaves no room, null is returned so the caller falls back to prompting
 * for a number rather than inventing a truncated one.
 */
export function buildReplacementInvoiceNumber(
  original: string | null | undefined,
  options: { maxLength?: number; now?: Date } = {},
): string | null {
  const base = escapeInvoiceNumberForXero(String(original ?? ""));
  if (!base) return null;

  const maxLength = options.maxLength ?? 20;
  if (base.length > maxLength) return null;

  const now = options.now ?? new Date();
  const yy = now.getUTCFullYear().toString().slice(2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");

  // Longest first, so the most informative suffix is preferred.
  for (const suffix of [`-R${yy}${mm}${dd}`, `-R${yy}${mm}`, "-R2", ""]) {
    if (base.length + suffix.length <= maxLength) return `${base}${suffix}`;
  }

  return null;
}

/**
 * Splits a push list into Xero-sized batches.
 *
 * Xero has no true bulk-create endpoint for bills, so "batching" here means
 * bounding the work per worker pass and holding it to the rate limiter, rather
 * than issuing one oversized request.
 */
export function chunkForXero<T>(items: T[], size: number = XERO_BATCH_SIZE): T[][] {
  const bounded = Math.max(1, size);
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += bounded) {
    chunks.push(items.slice(index, index + bounded));
  }
  return chunks;
}

/**
 * Pushes a candidate list through the Xero limiter.
 *
 * Concurrency is capped at five and each request is separately throttled by the
 * shared limiter, so the two controls compose rather than fight: the worker pool
 * bounds how many are in flight, the limiter bounds how many are started per
 * minute.
 */
export async function pushInBatches<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  options: { batchSize?: number; concurrency?: number } = {},
): Promise<R[]> {
  const chunks = chunkForXero(items, options.batchSize ?? XERO_BATCH_SIZE);
  const collected: R[] = [];
  for (const chunk of chunks) {
    const results = await mapWithConcurrency(chunk, options.concurrency ?? XERO_MAX_CONCURRENT, worker);
    collected.push(...results);
  }
  return collected;
}
