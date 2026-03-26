export interface UploadResponse {
  clipId: string;
  blobUrl: string;
  duration: number;
}

export interface DetectRequest {
  clipId: string;
  blobUrl: string;
  serveMark: number | null;
}

export interface DetectResponse {
  jobId: string;
}

export interface StatusResponse {
  status: 'processing' | 'done' | 'failed';
  contactTime?: number;
  confidence?: number;
  thumbnailUrl?: string;
  error?: string;
}

export type ClipStatus = 'idle' | 'uploading' | 'detecting' | 'ready' | 'error';

export interface Clip {
  clipId: string;
  blobUrl: string;
  duration: number;
  contactTime: number;
  confidence: number;
  thumbnailUrl: string;
  name: string;
}
