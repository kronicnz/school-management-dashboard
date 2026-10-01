import React, { useState, useEffect } from 'react';

interface JobStatus {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
}

export function useFinanceJob(jobId: string) {
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJobStatus(null);
      return;
    }

    let isMounted = true;
    async function fetchStatus() {
      try {
        const response = await fetch(`/api/finance-job?jobId=${jobId}`);
        if (!response.ok) throw new Error('Failed fetching job status');
        const json = await response.json();
        if (isMounted) {
          setJobStatus(json);
        }
      } catch (error) {
        if (isMounted) {
          setJobStatus({ id: jobId, status: 'failed', error: String(error) });
        }
      }
    }

    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [jobId]);

  return jobStatus;
}

interface FinanceJobInput {
  rawDocument: string;
  metadata?: Record<string, any>;
  onSuccess?: (data: any) => void;
  onError?: (error: any) => void;
}

export function FinanceJobClient({ rawDocument, metadata, onSuccess, onError }: FinanceJobInput) {
  const [jobId, setJobId] = React.useState<string | null>(null);
  const jobStatus = useFinanceJob(jobId ?? '');

  React.useEffect(() => {
    if (!jobId) {
      async function startJob() {
        try {
          const response = await fetch('/api/finance-job', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rawDocument, metadata }),
          });
          if (!response.ok) {
            throw new Error('Failed to start extraction job');
          }
          const data = await response.json();
          setJobId(data.jobId);
        } catch (err) {
          onError?.(err);
        }
      }
      startJob();
    } else if (jobStatus?.status === 'completed') {
      onSuccess?.(jobStatus.result);
    } else if (jobStatus?.status === 'failed') {
      onError?.(jobStatus.error);
    }
  }, [jobId, jobStatus, rawDocument, metadata, onError, onSuccess]);

  return <span>Job Status: {jobStatus?.status ?? 'idle'}</span>;
}
