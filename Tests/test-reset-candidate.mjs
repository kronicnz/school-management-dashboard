import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://127.0.0.1:54321', 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz');
const candidateId = process.argv[2];
if (!candidateId) {
  console.log('usage: node test-reset-candidate.mjs <candidateId> [status]');
  process.exit(1);
}
const status = process.argv[3] ?? 'validated';

const { data: links } = await supabase
  .from('finance_xero_links')
  .select('id')
  .eq('candidate_id', candidateId);
for (const link of links ?? []) {
  await supabase.from('finance_xero_links').delete().eq('id', link.id);
}
const { error } = await supabase
  .from('finance_invoice_candidates')
  .update({ status, xero_contact_id: null })
  .eq('id', candidateId);
console.log(`cleared ${links?.length ?? 0} link(s), set status to ${status}`, error?.message ?? 'ok');
