import type { StatusResponse } from '@/types';

const jobs = new Map<string, StatusResponse>();

export function setJob(jobId: string, data: StatusResponse) {
  jobs.set(jobId, data);
}

export function getJob(jobId: string): StatusResponse | undefined {
  return jobs.get(jobId);
}
