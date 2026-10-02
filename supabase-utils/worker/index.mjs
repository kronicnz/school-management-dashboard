import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const rootEnv = loadEnvFile(path.resolve(__dirname, '../../.env.local'));
const SUPABASE_URL = process.env.SUPABASE_URL || rootEnv.SUPABASE_URL || rootEnv.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || rootEnv.SUPABASE_SERVICE_ROLE_KEY || rootEnv.SUPABASE_INTERNAL_SECRET_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const POLL_INTERVAL_MS = 2500;
const MAX_CONCURRENCY = 3;
let active = 0;

async function claimNextJob() {
  const { data, error } = await supabase
    .from('finance_intake_jobs')
    .select('id,intake_item_id,job_type,payload,status')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  const { data: updated, error: updateError } = await supabase
    .from('finance_intake_jobs')
    .update({
      status: 'processing',
      locked_at: new Date().toISOString(),
      locked_by: 'local-worker',
      attempt_count: 1,
    })
    .eq('id', data.id)
    .eq('status', 'queued')
    .select('id,intake_item_id,job_type,payload')
    .maybeSingle();

  if (updateError || !updated) return null;
  return updated;
}

async function finishJob(jobId, intakeItemId, message) {
  await supabase.from('finance_intake_jobs').update({
    status: 'completed',
    locked_at: null,
    locked_by: null,
    last_error: null,
  }).eq('id', jobId);

  await supabase.from('finance_intake_items').update({
    status: 'draft',
    confidence: 0,
    processed_at: new Date().toISOString(),
    extraction_summary: {
      worker: 'local-worker',
      message,
    },
  }).eq('id', intakeItemId);
}

async function failJob(jobId, intakeItemId, error) {
  const message = error instanceof Error ? error.message : String(error);
  await supabase.from('finance_intake_jobs').update({
    status: 'failed',
    last_error: message,
    locked_at: null,
    locked_by: null,
  }).eq('id', jobId);

  await supabase.from('finance_intake_items').update({
    status: 'failed',
    failed_at: new Date().toISOString(),
    failure_reason: message,
  }).eq('id', intakeItemId);
}

async function runJobLoop() {
  if (active >= MAX_CONCURRENCY) return;
  const job = await claimNextJob();
  if (!job) return;

  active += 1;
  try {
    console.info(`Processing finance job ${job.id} (${job.job_type})`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    await finishJob(job.id, job.intake_item_id, 'Job processed by local worker');
  } catch (error) {
    console.error(`Finance job ${job.id} failed`, error);
    await failJob(job.id, job.intake_item_id, error);
  } finally {
    active -= 1;
  }
}

setInterval(() => {
  void runJobLoop();
}, POLL_INTERVAL_MS);

console.log('Finance extraction worker running');
