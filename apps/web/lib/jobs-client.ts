import type { CrawlJob } from '@larkup/core/types';

export interface JobsResponse {
  jobs: CrawlJob[];
  configured: boolean;
}

export async function fetchJobsWithSync(url: string): Promise<JobsResponse> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load jobs.');
  const { jobs, configured } = (await response.json()) as JobsResponse;
  const active = jobs.filter((job) => job.status === 'running' || job.status === 'queued');
  if (active.length === 0) return { jobs, configured };

  const advanced = await Promise.all(
    active.map((job) =>
      fetch(`/api/jobs/${job.id}`)
        .then((result) => result.json())
        .then((result) => result.job as CrawlJob)
        .catch(() => job),
    ),
  );
  const advancedById = new Map(advanced.map((job) => [job.id, job]));
  return { jobs: jobs.map((job) => advancedById.get(job.id) ?? job), configured };
}
