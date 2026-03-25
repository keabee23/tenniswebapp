// Basic in-memory rate limiter — no external dependencies.
// Keyed by IP. Resets per window. Acceptable for v1 (single-instance Vercel serverless).

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 10; // uploads per IP per minute

// GC: remove stale buckets older than 2 windows
function gc() {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [key, bucket] of buckets) {
    if (bucket.windowStart < cutoff) buckets.delete(key);
  }
}

/**
 * Returns true if the request should be allowed, false if rate-limited.
 */
export function checkRateLimit(ip: string): boolean {
  gc();
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (bucket.count >= MAX_PER_WINDOW) return false;

  bucket.count++;
  return true;
}
