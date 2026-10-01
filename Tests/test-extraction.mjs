import { createClient } from '@supabase/supabase-js';
const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');

const rawText = [
  'Invoice INV-007',
  'Invoice Date: 2026-08-23',
  'Due Date: 2026-09-23',
  'Test Company Ltd',
  'Address: 123 Test St',
  'Line Item 1: 2 x $25.00 = $50.00',
  'Line Item 2: 1 x $10.00 = $10.00',
  'Subtotal: $60.00',
  'GST (10%): $6.00',
  'Total: $66.00',
].join('\n');

// Enqueue
const res = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: 'enqueue',
    source: 'manual_upload',
    sourceFingerprint: 'test-proper-' + Date.now(),
    subject: 'Invoice INV-007',
    senderEmail: 'accounts@testcompany.com',
    metadata: { rawText: rawText }
  })
});
const data = await res.json();
console.log('Enqueue:', JSON.stringify(data));
if (!data.ok || !data.jobId) process.exit(1);

// Process
const res2 = await fetch('http://127.0.0.1:54321/functions/v1/finance-intake', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'process', limit: 1 })
});
const data2 = await res2.json();
console.log('Process:', JSON.stringify(data2, null, 2));

// Query candidate
const { data: cands, error } = await supabase
  .from('finance_invoice_candidates')
  .select('*')
  .eq('id', data2.results?.[0]?.candidateId || 'noop')
  .single();

if (error) {
  console.log('DB Error:', error.message);
  process.exit(1);
}

console.log('\n--- Extracted Candidate ---');
console.log('supplier_name:', cands.supplier_name);
console.log('invoice_number:', cands.invoice_number);
console.log('invoice_date:', cands.invoice_date);
console.log('due_date:', cands.due_date);
console.log('gross_total:', cands.gross_total);
console.log('subtotal:', cands.subtotal);
console.log('tax_total:', cands.tax_total);
console.log('line_items:', JSON.stringify(cands.line_items, null, 2));
console.log('confidence:', cands.confidence);
console.log('status:', cands.status);
console.log('\n--- structured (from extraction_payload) ---');
console.log(JSON.stringify(cands.extraction_payload?.sourceLayers?.structured, null, 2));
