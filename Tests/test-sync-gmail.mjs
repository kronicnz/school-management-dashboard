const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'sync_gmail' }),
});
const data = await res.json();
console.log('sync:', JSON.stringify(data, null, 2));
