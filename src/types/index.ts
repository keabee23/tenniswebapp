// Shared types — both Bacon and Kara import from here.
// Any change must be announced in INTERFACE.md changelog.

export interface ServeClip {
  id: string;              // nanoid
  blobUrl: string;         // Vercel Blob URL
  filename: string;
  duration: number;        // seconds
  playerLabel: string;     // "Player 1", custom name, etc.
  serveMark: number | null;       // user-marked rough timestamp (for long videos)
  contactTime: number | null;     // detected contact timestamp
  detectionStatus: 'pending' | 'processing' | 'done' | 'failed';
  confidence: number | null;      // 0–1 detection confidence
  thumbnailUrl: string | null;    // Blob URL of frame at contact point
}

export type ClipStatus = 'idle' | 'uploading' | 'detecting' | 'ready' | 'error';

export interface Comparison {
  id: string;
  clipA: string;           // ServeClip id
  clipB: string;           // ServeClip id
  manualOffset: number;    // ms, user fine-tune
  playbackSpeedB: number;  // speed multiplier for clip B
  createdAt: number;
}

// ── API contracts ──────────────────────────────────────────────────────────────

// POST /api/upload
// Body: FormData { file: File }
export interface UploadResponse {
  clipId: string;
  blobUrl: string;
  duration: number;
}

export interface UploadErrorResponse {
  error: string;
}

// POST /api/detect
// Body: DetectRequest
export interface DetectRequest {
  clipId: string;
  blobUrl: string;
  serveMark: number | null;
}

export interface DetectResponse {
  jobId: string;
}

export interface DetectErrorResponse {
  error: string;
}

// GET /api/status/[jobId]
export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface StatusResponse {
  status: JobStatus;
  contactTime?: number;
  confidence?: number;
  thumbnailUrl?: string;
  error?: string;
}
