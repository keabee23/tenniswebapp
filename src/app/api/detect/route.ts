import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import type { DetectRequest } from '@/types';
import { createJob, updateJob } from '@/lib/jobs';
import { getVideoDuration, extractThumbnail } from '@/lib/ffmpeg';
import { detectContact } from '@/lib/detection';
import { uploadBufferToBlob } from '@/lib/blob';
import { readFile } from 'fs/promises';

export async function POST(req: NextRequest) {
  let body: DetectRequest;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { clipId, blobUrl, serveMark } = body;

  if (!clipId || typeof clipId !== 'string') {
    return NextResponse.json({ error: 'clipId required' }, { status: 400 });
  }
  if (!blobUrl || typeof blobUrl !== 'string') {
    return NextResponse.json({ error: 'blobUrl required' }, { status: 400 });
  }

  const jobId = nanoid();
  createJob(jobId);

  // Run detection asynchronously — return jobId immediately so client can poll
  runDetection(jobId, clipId, blobUrl, serveMark ?? null).catch(e => {
    console.error(`[detect] Job ${jobId} unhandled error:`, e);
    updateJob(jobId, { status: 'failed', error: 'Unexpected error' });
  });

  return NextResponse.json({ jobId });
}

async function runDetection(
  jobId: string,
  clipId: string,
  blobUrl: string,
  serveMark: number | null
) {
  const tmpPath = path.join('/tmp', `detect_${jobId}.mp4`);
  const thumbPath = path.join('/tmp', `thumb_${jobId}.jpg`);

  try {
    updateJob(jobId, { status: 'processing' });

    // ── Download video from Blob ────────────────────────────────────────────
    const res = await fetch(blobUrl);
    if (!res.ok) throw new Error(`Failed to fetch video from Blob: ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    await mkdir('/tmp', { recursive: true });
    await writeFile(tmpPath, Buffer.from(arrayBuffer));

    // ── Get duration ────────────────────────────────────────────────────────
    const duration = await getVideoDuration(tmpPath);

    // ── Run two-pass detection ──────────────────────────────────────────────
    const result = await detectContact(tmpPath, duration, serveMark, jobId);

    // ── Extract thumbnail at contact frame ──────────────────────────────────
    await extractThumbnail(tmpPath, result.contactTime, thumbPath);
    const thumbBuffer = await readFile(thumbPath);
    const thumbnailUrl = await uploadBufferToBlob(
      thumbBuffer,
      `thumbnails/${clipId}_contact.jpg`,
      'image/jpeg'
    );

    updateJob(jobId, {
      status: 'done',
      contactTime: result.contactTime,
      confidence: result.confidence,
      thumbnailUrl,
    });
  } catch (e) {
    console.error(`[detect] Job ${jobId}:`, e);
    updateJob(jobId, {
      status: 'failed',
      error: e instanceof Error ? e.message : 'Detection failed',
    });
  } finally {
    // Clean up /tmp
    try { await unlink(tmpPath); } catch { /* non-fatal */ }
    try { await unlink(thumbPath); } catch { /* non-fatal */ }
  }
}
