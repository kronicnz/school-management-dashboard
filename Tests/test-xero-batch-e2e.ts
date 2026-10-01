// End-to-end check of the Xero post batch using the real MYOB candidate, whose number
// (2-10009929258) is already held by a DELETED bill. Verifies the batch reports the
// collision as a result instead of aborting, and returns an accurate summary.
import { createClient } from "npm:@supabase/supabase-js";

const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');
const { data: cands } = await supabase
  .from('finance_invoice_candidates')
  .select('id, supplier_name, invoice_number, status')
  .eq('status', 'validated');

console.log('validated candidates:');
for (const c of cands) console.log(`  ${c.id}  ${c.supplier_name}  ${c.invoice_number}`);

const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'post_xero', candidateIds: cands.map((c) => c.id) }),
});
const result = await res.json();

console.log('\n--- response ---');
console.log('ok:', result.ok, '| aborted:', result.aborted ?? false);
console.log('summary:', JSON.stringify(result.summary?.total !== undefined
  ? { ...result.summary, attention: (result.summary.attention ?? []).map((a) => `${a.invoiceNumber}:${a.status}`) }
  : result.summary, null, 2));

console.log('\n--- per-candidate outcomes ---');
for (const r of result.results ?? []) {
  console.log(`  ${r.status.padEnd(18)} ${String(r.supplier ?? '').padEnd(22)} ${r.invoiceNumber ?? ''}  xero=${r.xeroStatus ?? '-'}`);
}

const summary = result.summary ?? {};
const outcomes = result.results ?? [];
const expectations = [];
expectations.push(['every candidate produced a result', outcomes.length === cands.length]);
expectations.push(['summary total matches candidates', summary.total === cands.length]);
expectations.push(['nothing aborted', result.ok === true && (result.aborted ?? false) === false]);
expectations.push(['the batch is not all-or-nothing', outcomes.some((r) => r.status === 'skipped' || r.status === 'already_exists') || summary.posted > 0]);
// A number Xero has consumed is reported as a result, never thrown out of the loop. Which
// candidate hits this depends on what has already been posted, so assert the shape of the
// report rather than a specific invoice.
expectations.push([
  'a consumed number is reported as a result, not thrown',
  outcomes.some((r) => r.status === 'number_consumed' && r.xeroStatus && String(r.error).includes('permanently consumes')),
]);

console.log('\n--- expectations ---');
let failed = 0;
for (const [name, pass] of expectations) {
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(failed === 0 ? '\nAll batch behaviour checks passed' : `\n${failed} check(s) failed`);
Deno.exit(failed === 0 ? 0 : 1);
