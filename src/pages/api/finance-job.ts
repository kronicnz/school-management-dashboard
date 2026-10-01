import type { NextApiRequest, NextApiResponse } from 'next';

// Proxy to Supabase edge function finance-extraction-api
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'POST') {
      const response = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/start-job', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body),
      });
      const data = await response.json();
      res.status(200).json(data);
      return;
    }

    if (req.method === 'GET') {
      const jobId = req.query.jobId;
      if (!jobId || Array.isArray(jobId)) {
        res.status(400).json({ error: 'Missing or invalid jobId' });
        return;
      }
      const response = await fetch(`http://localhost:54321/job-status?jobId=${jobId}`);
      if (response.status === 404) {
        res.status(404).json({ error: 'Job not found' });
        return;
      }
      const data = await response.json();
      res.status(200).json(data);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
