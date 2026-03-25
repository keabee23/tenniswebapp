import { put, del } from '@vercel/blob';

const BLOB_TTL_SECONDS = 60 * 60 * 24; // 24 hours

/**
 * Upload a file to Vercel Blob.
 * Returns the public Blob URL.
 */
export async function uploadToBlob(
  file: File,
  pathname: string
): Promise<string> {
  const { url } = await put(pathname, file, {
    access: 'public',
    addRandomSuffix: true,
    // Vercel Blob TTL via cache-control
    cacheControlMaxAge: BLOB_TTL_SECONDS,
  });
  return url;
}

/**
 * Upload a Buffer (e.g. a thumbnail extracted in /tmp) to Vercel Blob.
 * Returns the public Blob URL.
 */
export async function uploadBufferToBlob(
  buffer: Buffer,
  pathname: string,
  contentType: string
): Promise<string> {
  const { url } = await put(pathname, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType,
    cacheControlMaxAge: BLOB_TTL_SECONDS,
  });
  return url;
}

/**
 * Delete a file from Vercel Blob by URL.
 * Silently ignores errors (best-effort cleanup).
 */
export async function deleteFromBlob(url: string): Promise<void> {
  try {
    await del(url);
  } catch {
    // Non-fatal — log but don't throw
    console.warn('[blob] Failed to delete:', url);
  }
}
