const candidateIds = process.argv.slice(2);

if (candidateIds.length === 0) {
  console.log('usage: node test-xero-post.mjs <candidateId...>');
  process.exit(1);
}

const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'post_xero', candidateIds }),
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
