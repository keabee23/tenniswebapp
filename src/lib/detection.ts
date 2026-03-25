import { rmdir } from 'fs/promises';
import path from 'path';
import { extractFrames, readPPM, cleanupFiles } from './ffmpeg';

// ── Constants ──────────────────────────────────────────────────────────────────

const COARSE_INTERVAL_MS = 50;   // 20fps equivalent — pass 1
const FINE_INTERVAL_MS = 16;     // ~60fps — pass 2
const COARSE_WINDOW_S = 5;       // ±2.5s around serve mark
const FINE_WINDOW_S = 0.6;       // ±0.3s around coarse peak
const UPPER_ZONE_FRACTION = 0.4; // analyze top 40% of frame only

export interface DetectionResult {
  contactTime: number;  // seconds from video start
  confidence: number;   // peakEnergy / meanEnergy (higher = clearer contact)
  coarsePeakTime: number;
  finePeakTime: number;
}

/**
 * Full two-pass contact detection.
 *
 * @param videoPath  Absolute path to local video file
 * @param duration   Video duration in seconds
 * @param serveMark  User hint (center of search window). If null, uses midpoint.
 * @param tmpPrefix  Unique prefix for /tmp subdirectories (e.g. the jobId)
 */
export async function detectContact(
  videoPath: string,
  duration: number,
  serveMark: number | null,
  tmpPrefix: string
): Promise<DetectionResult> {
  const center = serveMark ?? duration / 2;

  // ── Pass 1: Coarse ──────────────────────────────────────────────────────────
  const coarseStart = Math.max(0, center - COARSE_WINDOW_S / 2);
  const coarseEnd = Math.min(duration, center + COARSE_WINDOW_S / 2);
  const coarseDir = `/tmp/${tmpPrefix}_coarse`;

  let coarseFrames = await extractFrames(
    videoPath, coarseStart, coarseEnd, COARSE_INTERVAL_MS, coarseDir
  );

  const coarseEnergies = await computeMotionEnergies(coarseFrames.map(f => f.framePath));
  const coarsePeakIdx = argmax(coarseEnergies);
  const coarsePeakTime = coarseFrames[coarsePeakIdx + 1]?.time ?? coarseFrames[coarsePeakIdx].time;

  log(`Pass 1 complete. ${coarseFrames.length} frames. Peak @ ${coarsePeakTime.toFixed(3)}s. ` +
    `Energy: peak=${coarseEnergies[coarsePeakIdx].toFixed(0)}, ` +
    `mean=${mean(coarseEnergies).toFixed(0)}`);

  await cleanupFrameDir(coarseFrames.map(f => f.framePath), coarseDir);

  // ── Pass 2: Fine ────────────────────────────────────────────────────────────
  const fineStart = Math.max(0, coarsePeakTime - FINE_WINDOW_S / 2);
  const fineEnd = Math.min(duration, coarsePeakTime + FINE_WINDOW_S / 2);
  const fineDir = `/tmp/${tmpPrefix}_fine`;

  const fineFrames = await extractFrames(
    videoPath, fineStart, fineEnd, FINE_INTERVAL_MS, fineDir
  );

  const fineEnergies = await computeMotionEnergies(fineFrames.map(f => f.framePath));
  const finePeakIdx = argmax(fineEnergies);
  // Energy between frame N and N+1 → contact is at frame N+1 (after peak motion)
  const finePeakTime = fineFrames[finePeakIdx + 1]?.time ?? fineFrames[finePeakIdx].time;

  const peakEnergy = fineEnergies[finePeakIdx];
  const meanEnergy = mean(fineEnergies);
  const confidence = meanEnergy > 0 ? Math.min(peakEnergy / meanEnergy / 10, 1) : 0;

  log(`Pass 2 complete. ${fineFrames.length} frames. Peak @ ${finePeakTime.toFixed(3)}s. ` +
    `Energy: peak=${peakEnergy.toFixed(0)}, mean=${meanEnergy.toFixed(0)}, ` +
    `confidence=${confidence.toFixed(2)}`);

  await cleanupFrameDir(fineFrames.map(f => f.framePath), fineDir);

  return {
    contactTime: finePeakTime,
    confidence,
    coarsePeakTime,
    finePeakTime,
  };
}

// ── Motion energy ──────────────────────────────────────────────────────────────

/**
 * For each consecutive pair of frames, compute the motion energy:
 * sum of absolute RGB differences in the upper UPPER_ZONE_FRACTION of the frame.
 *
 * Returns N-1 energy values for N frames.
 */
async function computeMotionEnergies(framePaths: string[]): Promise<number[]> {
  if (framePaths.length < 2) return [];

  const energies: number[] = [];
  let prevPixels: Buffer | null = null;
  let prevWidth = 0;
  let prevHeight = 0;

  for (const framePath of framePaths) {
    const { width, height, pixels } = await readPPM(framePath);

    if (prevPixels !== null) {
      const energy = pixelDiffUpperZone(
        prevPixels, pixels,
        prevWidth, prevHeight
      );
      energies.push(energy);
    }

    prevPixels = pixels;
    prevWidth = width;
    prevHeight = height;
  }

  return energies;
}

/**
 * Sum of |R1-R2| + |G1-G2| + |B1-B2| for each pixel in the upper zone.
 * Upper zone = top UPPER_ZONE_FRACTION rows.
 */
function pixelDiffUpperZone(
  a: Buffer,
  b: Buffer,
  width: number,
  height: number
): number {
  const upperRows = Math.floor(height * UPPER_ZONE_FRACTION);
  const upperPixels = upperRows * width;
  const upperBytes = upperPixels * 3;

  let energy = 0;
  const len = Math.min(upperBytes, a.length, b.length);

  for (let i = 0; i < len; i++) {
    energy += Math.abs(a[i] - b[i]);
  }

  return energy;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function argmax(arr: number[]): number {
  let maxIdx = 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > arr[maxIdx]) maxIdx = i;
  }
  return maxIdx;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

async function cleanupFrameDir(framePaths: string[], dir: string): Promise<void> {
  await cleanupFiles(framePaths);
  try { await rmdir(dir); } catch { /* non-fatal */ }
}

function log(msg: string) {
  console.log(`[detection] ${msg}`);
}
