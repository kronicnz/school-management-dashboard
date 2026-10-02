import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');

const { data: cands, error } = await supabase
  .from('finance_invoice_candidates')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(20);
if (error) throw error;

console.log('candidates:', cands.length);
for (const c of cands) {
  const items = Array.isArray(c.line_items) ? c.line_items : [];
  const lineSum = items.reduce((t, i) => t + Number(i.LineAmount ?? 0), 0);
  console.log(
    `\n${c.id}\n  supplier=${c.supplier_name} | number=${c.invoice_number} | date=${c.invoice_date} due=${c.due_date}\n` +
    `  sub=${c.subtotal} tax=${c.tax_total} gross=${c.gross_total} | lines=${items.length} lineSum=${lineSum} lineSum==sub? ${Math.abs(lineSum - Number(c.subtotal)) <= 0.05}\n` +
    `  confidence=${c.confidence} status=${c.status} match_state=${c.match_state} xero_contact=${c.xero_contact_id ?? '-'}`,
  );
  for (const i of items) console.log(`     - ${JSON.stringify(i)}`);
  const flags = c.validation_flags ?? {};
  console.log('  flags:', JSON.stringify(flags));
}

const { data: events } = await supabase
  .from('finance_processing_events')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10);
console.log('\n=== recent events ===');
for (const e of events ?? []) {
  console.log(`${e.created_at} | ${e.event_type} (${e.severity}) | cand=${e.candidate_id}`);
  console.log('   ', JSON.stringify(e.details).slice(0, 600));
}
