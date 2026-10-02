const jobId = process.argv[2];
const body = jobId ? { action: 'process', jobId } : { action: 'process' };
const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
console.log(JSON.stringify(await res.json(), null, 2));
