import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');
const FN = 'http://127.0.0.1:54321/functions/v1/finance-intake';

const cases = [
  {
    name: 'multi-line table with wrapped description, exclusive totals',
    subject: 'Tax Invoice 88213 - Hornby Hardware',
    senderEmail: 'billing@hornbyhardware.co.nz',
    rawText: [
      'HORNBY HARDWARE LTD',
      'GST 42-118-776',
      '12 Kahikatea Road, Hamilton',
      'TAX INVOICE',
      'Invoice No: 88213',
      'Invoice Date: 03/09/2026',
      'Due Date: 17/09/2026',
      'Terms: NET 14',
      'PO Reference: PO-4471',
      'Bill To: Rimu School',
      '',
      'Description                          Qty    Unit Price    Amount',
      'Managed network support -            1      850.00        850.00',
      '  per month, 12 month term',
      'Onsite hardware installation         4      125.00        500.00',
      'Annual cloud licence renewal         1      2400.00       2400.00',
      'Travel and accommodation              1      318.50        318.50',
      '',
      'Subtotal (Excl. GST)                           4068.50',
      'GST 15%                                          610.28',
      'Total Including GST                             4678.78',
    ].join('\n'),
  },
  {
    name: 'single item, GST-inclusive amounts only',
    subject: 'Re: Invoice 9911',
    senderEmail: 'accounts@paperco.nz',
    rawText: [
      'PAPER CO LTD',
      'Tax Invoice 9911',
      'Date: 2026-09-01',
      'Item: A4 paper cartons   Qty 10   Unit 55.00   Amount 550.00',
      'GST 82.50',
      'Total 632.50',
    ].join('\n'),
  },
  {
    name: 'no itemised table, single inclusive total only',
    subject: 'Invoice',
    senderEmail: 'noreply@cloudhost.example.com',
    rawText: [
      'CLOUDHOST',
      'Receipt for monthly subscription',
      'Paid on 15 Aug 2026',
      'Total paid: NZD 249.00',
    ].join('\n'),
  },
  {
    name: 'poor email subject, supplier only in document',
    subject: 'Fw: Invoice IV00004431; From Computer Fusion',
    senderEmail: 'Shane Byrne <admin@computerfusion.co.nz>',
    rawText: [
      'COMPUTER FUSION LTD',
      'GST 987-654-321',
      'Invoice IV00004431',
      'Invoice date: 23 Aug 2026',
      'Due date: 22 Sep 2026',
      'Service - Managed IT support (August 2026)   Qty 1   1,200.00',
      'Hardware - Replacement docking station        Qty 2     385.00',
      'Subtotal 1,970.00',
      'GST 295.50',
      'Total 2,265.50',
    ].join('\n'),
  },
];

async function runCase(testCase) {
  const enqueue = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'enqueue',
      source: 'manual_upload',
      sourceFingerprint: 'test-case-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      subject: testCase.subject,
      senderEmail: testCase.senderEmail,
      metadata: { rawText: testCase.rawText },
    }),
  }).then((r) => r.json());

  if (!enqueue.ok || !enqueue.jobId) {
    console.log('ENQUEUE FAILED', JSON.stringify(enqueue));
    return;
  }

  const process = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'process', limit: 1, jobId: enqueue.jobId }),
  }).then((r) => r.json());

  const candidateId = process.results?.[0]?.candidateId;
  if (!candidateId) {
    console.log('PROCESS FAILED', JSON.stringify(process));
    return;
  }

  const { data: cand, error } = await supabase
    .from('finance_invoice_candidates')
    .select('*')
    .eq('id', candidateId)
    .single();
  if (error) return console.log('DB Error:', error.message);

  const lineItems = Array.isArray(cand.line_items) ? cand.line_items : [];
  const lineSum = lineItems.reduce((t, i) => t + Number(i.LineAmount ?? 0), 0);
  const balanced = Math.abs((Number(cand.subtotal) + Number(cand.tax_total)) - Number(cand.gross_total)) <= 0.05;

  console.log('\n=========== ' + testCase.name + ' ===========');
  console.log('subject in      :', testCase.subject);
  console.log('supplier_name   :', cand.supplier_name);
  console.log('invoice_number  :', cand.invoice_number);
  console.log('invoice_date    :', cand.invoice_date, '| due_date:', cand.due_date);
  console.log('subtotal/tax/gross:', cand.subtotal, '/', cand.tax_total, '/', cand.gross_total);
  console.log('lineItem count  :', lineItems.length, '| line sum:', lineSum, '| lineSum===subtotal:', Math.abs(lineSum - Number(cand.subtotal)) <= 0.05);
  console.log('totals balanced :', balanced);
  console.log('confidence      :', cand.confidence, '| status:', cand.status);
  console.log('line_items      :');
  for (const item of lineItems) {
    console.log('   -', JSON.stringify(item));
  }
  const flags = cand.validation_flags || {};
  console.log('flags           :', JSON.stringify({ totalsBalanced: flags.totalsBalanced, lineItemsMatchSubtotal: flags.lineItemsMatchSubtotal, lineItemTotal: flags.lineItemTotal }));
}

for (const testCase of cases) {
  await runCase(testCase);
}
