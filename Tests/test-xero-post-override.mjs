const candidateIds = process.argv.slice(2);
const overrides = candidateIds.length > 0 ? { [candidateIds[0]]: process.env.NEW_NUMBER ?? 'IV00004431-CORRECTED' } : undefined;

const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'post_xero', candidateIds, invoiceNumberOverrides: overrides }),
});
console.log(JSON.stringify(await res.json(), null, 2));
