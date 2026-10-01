/**
 * The school's calendar day.
 *
 * Role windows (`user_roles.effective_from` / `effective_to`), attendance dates,
 * and every other "is this today?" comparison are plain `YYYY-MM-DD` calendar
 * dates, not instants. A calendar date only means something relative to a
 * timezone, and this application has exactly one correct answer: the school's.
 *
 * Three frames were previously in play, and they disagreed:
 *
 *   - `new Date().toISOString().slice(0, 10)` is UTC. A viewer in Auckland
 *     between midnight and noon local was always handed yesterday's date, so a
 *     grant starting "today" read as not yet in force and the navigation
 *     collapsed to an empty shell.
 *   - `new Date().getFullYear()` and friends are the *viewer's* local zone, so a
 *     relief teacher abroad and the school's own admin could disagree about
 *     whether a window was open.
 *   - `current_date` in Postgres is the *database* zone.
 *
 * Everything now resolves through this module, so the client, the admin screen,
 * and the server all compare in the same frame. The matching database change
 * lives in `supabase/migrations/20260932400000_align_school_calendar.sql`, which
 * sets the database timezone and pins the role-window comparison explicitly so it
 * no longer depends on server configuration.
 *
 * `Pacific/Auckland` rather than a fixed `+12:00` because New Zealand daylight
 * saving shifts the offset by an hour twice a year; a fixed offset would be an
 * hour wrong for a fortnight every March and November, which is exactly the kind
 * of bug that is invisible until it is somebody's pay date.
 */

export const SCHOOL_TIME_ZONE = "Pacific/Auckland"

/**
 * Formatter pinned to `en-CA` because that locale already renders ISO-ordered
 * `YYYY-MM-DD`. Formatting in the school zone and slicing the result is what
 * makes this correct; `en-CA` only supplies the ordering.
 */
const schoolDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SCHOOL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})

/**
 * Today in the school timezone, as `YYYY-MM-DD`.
 *
 * Defaults to now; pass a date to resolve a specific instant, which is what the
 * tests do to pin the UTC-day-rollover behaviour that used to cause this.
 */
export function todayInSchoolZone(now: Date = new Date()): string {
  return schoolDateFormatter.format(now)
}

/**
 * A date `days` away from today in the school timezone, as `YYYY-MM-DD`.
 *
 * Used for "starts in 30 days" style defaults in forms. Implemented by shifting
 * the instant rather than the calendar arithmetic, so it stays correct across a
 * daylight saving boundary where the school day is 23 or 25 hours long.
 */
export function schoolDateAfter(days: number, now: Date = new Date()): string {
  return todayInSchoolZone(new Date(now.getTime() + days * 24 * 60 * 60 * 1000))
}

/**
 * Whether a `YYYY-MM-DD` window contains today in the school timezone.
 *
 * A null bound means "open ended", matching the database's own null handling in
 * `user_has_role`. Comparison is lexicographic, which is valid for ISO dates and
 * avoids constructing a `Date` that would drag the UTC problem straight back in.
 */
export function isDateWindowInForce(
  window: { effective_from: string | null; effective_to: string | null },
  now: Date = new Date(),
): boolean {
  const today = todayInSchoolZone(now)
  if (window.effective_from && window.effective_from > today) return false
  if (window.effective_to && window.effective_to < today) return false
  return true
}
