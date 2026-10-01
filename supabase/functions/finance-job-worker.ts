import { createClient } from '@supabase/supabase-js';
import { AsyncQueue, IngestionJob, processIngestionJob } from './finance-extraction-pipeline';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const queue = new AsyncQueue<IngestionJob>();

const MAX_CONCURRENCY = 5;
let activeWorkers = 0;

async function worker() {
  while (true) {
    if (activeWorkers >= MAX_CONCURRENCY) {
      await new Promise((res) => setTimeout(res, 100));
      continue;
    }

    const job = await queue.dequeue();
    if (!job) {
      await new Promise((res) => setTimeout(res, 100));
      continue;
    }

    activeWorkers++;
    processIngestionJob(job)
      .then(() => {
        supabase
          .from('job_states')
          .update({ status: 'completed' })
          .eq('id', job.id);
      })
      .catch((error) => {
        supabase
          .from('job_states')
          .update({ status: 'failed', error: error.message })
          .eq('id', job.id);
      })
      .finally(() => {
        activeWorkers--;
      });
  }
}

worker();

export async function enqueueJob(job: IngestionJob) {
  await supabase.from('job_states').insert([{ id: job.id, status: 'queued' }]);
  queue.enqueue(job);
}
