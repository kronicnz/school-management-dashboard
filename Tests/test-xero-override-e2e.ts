// End-to-end check that a user-supplied replacement number posts the bill, and that the
// original supplier number survives in the bill's Reference so the source stays traceable.
const MYOB_CANDIDATE = "55d2bc29-05ce-4376-9759-d9e23ba315dc";
const CONSUMED_NUMBER = "2-10009929258";
const REPLACEMENT = process.env.REPLACEMENT_NUMBER ?? "2-10009929258-R1";

const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'post_xero',
    candidateIds: [MYOB_CANDIDATE],
    invoiceNumberOverrides: { [MYOB_CANDIDATE]: REPLACEMENT },
  }),
});
const result = await res.json();
console.log('ok:', result.ok);
console.log('summary:', JSON.stringify(result.summary, null, 2));
console.log('result:', JSON.stringify(result.results?.[0], null, 2));

const entry = result.results?.[0] ?? {};
const checks = [
  ['the bill was posted', entry.status === 'posted'],
  ['it used the replacement number', entry.xeroInvoiceNumber === REPLACEMENT],
  ['the original number is reported back', entry.originalInvoiceNumber === CONSUMED_NUMBER],
  ['the bill is flagged as renumbered', entry.renumbered === true],
  ['nothing needs attention', (result.summary?.attention ?? []).length === 0],
];

console.log('\n--- checks ---');
let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
}
console.log(failed === 0 ? `\nReplacement posted as ${REPLACEMENT}` : `\n${failed} check(s) failed`);
Deno.exit(failed === 0 ? 0 : 1);
