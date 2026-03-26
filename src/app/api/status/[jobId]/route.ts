import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { nanoid } from 'nanoid';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type))
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: 'File exceeds 100MB limit' }, { status: 400 });

    const clipId = nanoid();
    const blob = await put(`clips/${clipId}/${file.name}`, file, { access: 'public' });

    // Get duration via Web API (server-side we can't use HTMLVideoElement; return 0, frontend can fill)
    return NextResponse.json({ clipId, blobUrl: blob.url, duration: 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Upload failed' }, { status: 500 });
  }
}
