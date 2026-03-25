import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import { uploadToBlob } from '@/lib/blob';
import { getVideoDuration } from '@/lib/ffmpeg';
import { checkRateLimit } from '@/lib/ratelimit';

const ALLOWED_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

export async function POST(req: NextRequest) {
  // Rate limit by IP: 10 uploads/minute
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many uploads. Try again in a minute.' },
      { status: 429 }
    );
  }

  let tmpPath: string | null = null;

  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }

    // ── Validate ──────────────────────────────────────────────────────────────
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Use mp4, mov, or webm.` },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 100MB.` },
        { status: 400 }
      );
    }

    // ── Write to /tmp for ffprobe ─────────────────────────────────────────────
    const clipId = nanoid();
    const ext = file.name.split('.').pop() ?? 'mp4';
    tmpPath = path.join('/tmp', `upload_${clipId}.${ext}`);

    await mkdir('/tmp', { recursive: true });
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(tmpPath, Buffer.from(arrayBuffer));

    // ── Get duration ──────────────────────────────────────────────────────────
    const duration = await getVideoDuration(tmpPath);

    // ── Upload to Vercel Blob ─────────────────────────────────────────────────
    const blobUrl = await uploadToBlob(file, `clips/${clipId}.${ext}`);

    return NextResponse.json({ clipId, blobUrl, duration });
  } catch (e) {
    console.error('[upload]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed' },
      { status: 500 }
    );
  } finally {
    // Clean up /tmp regardless of success/failure
    if (tmpPath) {
      try { await unlink(tmpPath); } catch { /* non-fatal */ }
    }
  }
}
