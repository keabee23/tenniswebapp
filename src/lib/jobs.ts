import type { JobStatus } from '@/types';

export interface Job {
  id: string;
  status: JobStatus;
  contactTime?: number;
  confidence?: number;
  thumbnailUrl?: string;
  error?: string;
  createdAt: number;
}

// In-memory store. Jobs are lost on cold start — acceptable for v1 (no auth, session-scoped).
// Keyed by jobId (nanoid).
const jobs = new Map<string, Job>();

// Simple GC: remove jobs older than 2 hours to avoid unbounded memory growth.
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

function gc() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createJob(id: string): Job {
  gc();
  const job: Job = { id, status: 'pending', createdAt: Date.now() };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateJob(id: string, patch: Partial<Omit<Job, 'id' | 'createdAt'>>): Job {
  const job = jobs.get(id);
  if (!job) throw new Error(`Job not found: ${id}`);
  Object.assign(job, patch);
  return job;
}
