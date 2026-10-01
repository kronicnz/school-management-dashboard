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

let accessToken = env.XERO_ACCESS_TOKEN;
if (!accessToken) {
  const r = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.XERO_REFRESH_TOKEN,
      client_id: env.XERO_CLIENT_ID,
      client_secret: env.XERO_CLIENT_SECRET,
    }).toString(),
  });
  const j = await r.json();
  if (!j.access_token) { console.log('auth failed:', JSON.stringify(j).slice(0, 300)); process.exit(1); }
  accessToken = j.access_token;
}

let tenantId = env.XERO_TENANT_ID;
const auth = { Authorization: `Bearer ${accessToken}`, 'Xero-tenant-id': tenantId, Accept: 'application/json' };

const res = await fetch(
  'https://api.xero.com/api.xro/2.0/Invoices?page=1&order=Date DESC',
  { headers: auth },
).then((r) => r.json());
const bills = (res.Invoices ?? []).filter((i) => i.Type === 'ACCPAY');

console.log(`Xero ACCPAY bills: ${bills.length}\n`);
for (const b of bills) {
  console.log(`InvoiceID   ${b.InvoiceID}`);
  console.log(`  Number    ${b.InvoiceNumber ?? '(none)'}`);
  console.log(`  Status    ${b.Status}   Type ${b.Type}`);
  console.log(`  Contact   ${b.Contact?.Name}  (${b.Contact?.ContactID})`);
  console.log(`  Date      ${b.DateString}   Due ${b.DueDateString}`);
  console.log(`  Reference ${b.Reference ?? '(none)'}`);
  console.log(`  SubTotal  ${b.SubTotal}   Tax ${b.TotalTax}   Total ${b.Total}   LineAmountTypes ${b.LineAmountTypes}`);
  console.log(`  Lines (${(b.LineItems ?? []).length}):`);
  for (const li of b.LineItems ?? []) {
    console.log(`    - ${li.Description?.slice(0, 70)}`);
    console.log(`      qty ${li.Quantity} x unit ${li.UnitAmount} = line ${li.LineAmount} | tax ${li.TaxAmount} | acct ${li.AccountCode} | ${li.TaxType}`);
  }
  console.log(`  url       https://app.xero.com/Accounting/Invoice/${b.InvoiceID}\n`);
}
