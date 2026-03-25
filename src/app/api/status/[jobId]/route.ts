import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/jobs';

export async function GET(
  _req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const { jobId } = params;

  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 404 });
  }

  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    ...(job.contactTime !== undefined && { contactTime: job.contactTime }),
    ...(job.confidence !== undefined && { confidence: job.confidence }),
    ...(job.thumbnailUrl !== undefined && { thumbnailUrl: job.thumbnailUrl }),
    ...(job.error !== undefined && { error: job.error }),
  });
}
