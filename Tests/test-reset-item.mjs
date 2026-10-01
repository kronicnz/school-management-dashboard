import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');
const candidateId = process.argv[2];
if (!candidateId) {
  console.log('usage: node test-reset-item.mjs <candidateId>');
  process.exit(1);
}

const { data: cand } = await supabase
  .from('finance_invoice_candidates')
  .select('id,intake_item_id')
  .eq('id', candidateId)
  .single();
if (!cand) {
  console.log('candidate not found');
  process.exit(1);
}

const itemId = cand.intake_item_id;
const { data: item } = await supabase
  .from('finance_intake_items')
  .select('source_fingerprint,subject')
  .eq('id', itemId)
  .single();
console.log('item:', itemId, '| fingerprint:', item?.source_fingerprint, '| subject:', item?.subject);

for (const [table, column, value] of [
  ['finance_xero_links', 'candidate_id', candidateId],
  ['finance_processing_events', 'candidate_id', candidateId],
  ['finance_invoice_candidates', 'id', candidateId],
  ['finance_intake_jobs', 'intake_item_id', itemId],
  ['finance_intake_items', 'id', itemId],
]) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  console.log(`delete ${table} by ${column}:`, error?.message ?? 'ok');
}

const { data: leftover } = await supabase.from('finance_intake_items').select('id').eq('source_fingerprint', item.source_fingerprint);
console.log('leftover items with same fingerprint:', leftover?.length ?? 0);
