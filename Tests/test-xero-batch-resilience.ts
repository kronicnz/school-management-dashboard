// Verifies the batch resilience rules for the Xero post: one bad invoice must not stop the
// rest, and every outcome must be reported with an accurate summary.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./supabase/functions/finance-intake/index.ts", import.meta.url), "utf8");

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

// The Gmail relabel must not be able to turn a successful Xero write into a failure.
check(
  "relabel is best effort",
  /async function markGmailMessageProcessed[\s\S]*?try \{[\s\S]*?\} catch \(error\) \{[\s\S]*?return \{ swapped: false/.test(source),
);
check(
  "relabel failure returns swapped false",
  source.includes("gmail_unavailable") && source.includes("gmail_modify_failed"),
);

// Gmail label swap removes the pending label and adds the processed label.
check(
  "relabel adds processed and removes pending",
  /addLabelIds: \[processedLabelId\],\s*\n\s*removeLabelIds: \[pendingLabelId\]/.test(source),
);
check(
  "relabel uses the modify endpoint",
  source.includes("/modify") && source.includes("users/me/messages/"),
);

// A renumbered bill must keep the supplier's own number somewhere findable.
check(
  "renumbering preserves the source number in Reference",
  source.includes("Source invoice no: ${originalInvoiceNumber}"),
);
check(
  "renumbering is reported in the result",
  source.includes("originalInvoiceNumber, renumbered: true"),
);

// Archived/deleted bills must be visible to the collision check.
check(
  "archived invoices are included in the lookup",
  source.includes("includeArchived=true"),
);

// Event logging must never abort the batch.
check(
  "event logging cannot throw",
  /async function recordFinanceEvent[\s\S]*?try \{[\s\S]*?\} catch \(error\) \{/.test(source),
);
// Every event insert must go through the guarded helper. The helper's own insert is the one
// legitimate direct call, so assert it is the only one and that it sits inside a try.
const directInserts = [...source.matchAll(/\.from\("finance_processing_events"\)\.insert\(/g)];
check("only the helper inserts events directly", directInserts.length === 1, `found ${directInserts.length}`);
check(
  "the direct insert is guarded inside recordFinanceEvent",
  directInserts.length === 1
  && /async function recordFinanceEvent\(supabase: any, event: Record<string, unknown>\) \{[\s\S]*?try \{[\s\S]*?\.from\("finance_processing_events"\)\.insert\([\s\S]*?\} catch \(error\) \{/.test(source),
);
// Every event write in the posting loop must go via the helper, not the table directly.
const postLoop = source.slice(source.indexOf("async function postCandidatesToXero"));
check("posting loop never inserts events directly", !/\.from\("finance_processing_events"\)\.insert\(/.test(postLoop));

// The response must distinguish "finished" from "aborted".
check("summary is returned on success", /ok: true,\s*\n\s*action: "post_xero",\s*\n\s*results,\s*\n/.test(source));
check("partial results survive an abort", /aborted: true,[\s\S]*?results,/.test(source));
check("summary classifies attention items", source.includes("summary.failed += 1") && source.includes("attention.push("));

console.log(failures === 0 ? "\nAll batch resilience checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
