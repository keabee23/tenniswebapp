import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
// @ts-ignore
import ffmpegPath from 'ffmpeg-static';
// @ts-ignore
import ffprobePath from 'ffprobe-static';

const execFileAsync = promisify(execFile);

async function getVideoDuration(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath.path, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', filePath,
  ]);
  const info = JSON.parse(stdout);
  return parseFloat(info.format.duration);
}

async function extractFrames(
  inputPath: string,
  outputDir: string,
  startTime: number,
  duration: number,
  fps: number,
): Promise<string[]> {
  const pattern = path.join(outputDir, 'frame_%05d.ppm');
  await execFileAsync(ffmpegPath, [
    '-ss', String(startTime),
    '-i', inputPath,
    '-t', String(duration),
    '-vf', `fps=${fps}`,
    '-f', 'image2',
    pattern,
  ]);
  return fs.readdirSync(outputDir)
    .filter(f => f.endsWith('.ppm'))
    .sort()
    .map(f => path.join(outputDir, f));
}

function motionEnergy(buf1: Buffer, buf2: Buffer, heightFraction = 0.4): number {
  // Parse PPM header: P6\nW H\n255\n
  let offset = 0;
  const readLine = () => {
    let line = '';
    while (offset < buf1.length && buf1[offset] !== 10) line += String.fromCharCode(buf1[offset++]);
    offset++;
    return line;
  };
  readLine(); // P6
  const [w, h] = readLine().split(' ').map(Number);
  readLine(); // 255
  const headerEnd = offset;
  const topRows = Math.floor(h * heightFraction);
  const pixelsPerRow = w * 3;
  let energy = 0;
  for (let row = 0; row < topRows; row++) {
    const base = headerEnd + row * pixelsPerRow;
    for (let col = 0; col < pixelsPerRow; col++) {
      energy += Math.abs(buf1[base + col] - buf2[base + col]);
    }
  }
  return energy;
}

export async function detectContact(
  blobUrl: string,
  serveMark: number | null,
  tmpDir: string,
): Promise<{ contactTime: number; confidence: number; thumbnailPath: string }> {
  // Download video
  const videoPath = path.join(tmpDir, 'input.mp4');
  const res = await fetch(blobUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(videoPath, buf);

  const duration = await getVideoDuration(videoPath);
  const center = serveMark ?? duration / 2;
  const windowStart = Math.max(0, center - 2.5);
  const windowDuration = Math.min(5, duration - windowStart);

  // Pass 1: coarse at 20fps (~50ms)
  const coarseDir = path.join(tmpDir, 'coarse');
  fs.mkdirSync(coarseDir);
  const coarseFrames = await extractFrames(videoPath, coarseDir, windowStart, windowDuration, 20);

  let maxEnergy = -1;
  let peakIdx = 0;
  const energies: number[] = [];
  for (let i = 1; i < coarseFrames.length; i++) {
    const e = motionEnergy(fs.readFileSync(coarseFrames[i - 1]), fs.readFileSync(coarseFrames[i]));
    energies.push(e);
    if (e > maxEnergy) { maxEnergy = e; peakIdx = i; }
  }

  const peakCoarseTime = windowStart + (peakIdx / 20);

  // Pass 2: fine at ~60fps (16ms) in ±0.3s around peak
  const fineStart = Math.max(0, peakCoarseTime - 0.3);
  const fineDuration = Math.min(0.6, duration - fineStart);
  const fineDir = path.join(tmpDir, 'fine');
  fs.mkdirSync(fineDir);
  const fineFrames = await extractFrames(videoPath, fineDir, fineStart, fineDuration, 60);

  let maxFine = -1;
  let finePeakIdx = 0;
  const fineEnergies: number[] = [];
  for (let i = 1; i < fineFrames.length; i++) {
    const e = motionEnergy(fs.readFileSync(fineFrames[i - 1]), fs.readFileSync(fineFrames[i]));
    fineEnergies.push(e);
    if (e > maxFine) { maxFine = e; finePeakIdx = i; }
  }

  const contactTime = fineStart + (finePeakIdx / 60);
  const meanEnergy = fineEnergies.reduce((a, b) => a + b, 0) / fineEnergies.length;
  const confidence = Math.min(1, maxFine / (meanEnergy * 10));

  // Thumbnail: extract one frame at contact point
  const thumbPath = path.join(tmpDir, 'thumb.jpg');
  await execFileAsync(ffmpegPath, [
    '-ss', String(contactTime),
    '-i', videoPath,
    '-frames:v', '1',
    '-q:v', '3',
    thumbPath,
  ]);

  return { contactTime, confidence, thumbnailPath: thumbPath };
}
