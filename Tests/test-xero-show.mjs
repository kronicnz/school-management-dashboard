import fs from 'node:fs';

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv('.env.local'), ...loadEnv('.env') };
const auth = {
  Authorization: `Bearer ${env.XERO_ACCESS_TOKEN}`,
  'Xero-tenant-id': env.XERO_TENANT_ID,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};

const number = process.argv[2] ?? 'IV00004431-CORRECTED';
const where = encodeURIComponent(`InvoiceNumber=="${number}"`);
const list = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${where}&page=1`, { headers: auth }).then((r) => r.json());

for (const inv of list.Invoices ?? []) {
  console.log(`InvoiceID   ${inv.InvoiceID}`);
  console.log(`  Number    ${inv.InvoiceNumber}   Status ${inv.Status}`);
  console.log(`  Contact   ${inv.Contact?.Name}`);
  console.log(`  Date      ${inv.DateString}   Due ${inv.DueDateString}`);
  console.log(`  Reference ${inv.Reference ?? '(none)'}`);
  console.log(`  SubTotal  ${inv.SubTotal}   Tax ${inv.TotalTax}   Total ${inv.Total}   ${inv.LineAmountTypes}`);
  console.log(`  Lines (${(inv.LineItems ?? []).length}):`);
  for (const li of inv.LineItems ?? []) {
    console.log(`    - ${li.Description}`);
    console.log(`      qty ${li.Quantity} x unit ${li.UnitAmount} = line ${li.LineAmount} | tax ${li.TaxAmount} | acct ${li.AccountCode} | ${li.TaxType}`);
  }
  console.log(`  url       https://app.xero.com/Accounting/Invoice/${inv.InvoiceID}`);
  if (process.argv.includes('--delete')) {
    const del = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ Status: 'DELETED' }),
    });
    console.log(`  cleanup   ${del.status}`);
  }
}
