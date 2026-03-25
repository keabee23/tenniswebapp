import { execFile } from 'child_process';
import { promisify } from 'util';
import { readdir, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require('ffmpeg-static');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobePath: string = require('ffprobe-static').path;

const execFileAsync = promisify(execFile);

export interface ExtractedFrame {
  time: number;      // seconds from start of video
  framePath: string; // absolute path to PPM file in /tmp
}

/**
 * Extract frames from a video file at evenly-spaced intervals.
 *
 * @param videoPath  Absolute path to the video file in /tmp
 * @param startTime  Start of window (seconds)
 * @param endTime    End of window (seconds)
 * @param intervalMs Interval between frames (milliseconds)
 * @param outputDir  Directory to write PPM frames into (must exist)
 * @returns Array of { time, framePath } sorted by time
 */
export async function extractFrames(
  videoPath: string,
  startTime: number,
  endTime: number,
  intervalMs: number,
  outputDir: string
): Promise<ExtractedFrame[]> {
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const duration = endTime - startTime;
  const fps = 1000 / intervalMs;

  // Extract frames as PPM (uncompressed, trivially parseable for pixel diff)
  // Width 480, height proportional. Upper-40% crop done at read time.
  await execFileAsync(ffmpegPath, [
    '-ss', String(startTime),
    '-i', videoPath,
    '-t', String(duration),
    '-vf', `fps=${fps},scale=480:-2`,
    '-f', 'image2',
    '-vcodec', 'ppm',          // PPM output, no compression
    path.join(outputDir, 'frame_%05d.ppm'),
  ]);

  // Enumerate the written files and reconstruct timestamps
  const files = (await readdir(outputDir))
    .filter(f => f.endsWith('.ppm'))
    .sort();

  return files.map((filename, i) => ({
    time: startTime + i * (intervalMs / 1000),
    framePath: path.join(outputDir, filename),
  }));
}

/**
 * Extract a single JPEG frame at an exact timestamp (for thumbnails).
 */
export async function extractThumbnail(
  videoPath: string,
  timestamp: number,
  outputPath: string
): Promise<void> {
  await execFileAsync(ffmpegPath, [
    '-ss', String(timestamp),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'scale=480:-2',
    '-q:v', '3',
    '-y',
    outputPath,
  ]);
}

/**
 * Get video duration in seconds using ffprobe.
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    videoPath,
  ]);

  const info = JSON.parse(stdout) as {
    streams?: Array<{ duration?: string; codec_type?: string }>;
  };

  const videoStream = info.streams?.find(s => s.codec_type === 'video');
  const dur = parseFloat(videoStream?.duration ?? '0');
  if (!dur || isNaN(dur)) throw new Error('Could not determine video duration');
  return dur;
}

/**
 * Read a PPM file and return its pixel data as a Buffer of RGB bytes,
 * along with width and height.
 */
export async function readPPM(
  framePath: string
): Promise<{ width: number; height: number; pixels: Buffer }> {
  const raw = await readFile(framePath);

  // PPM P6 header: "P6\n{width} {height}\n{maxval}\n" then binary RGB
  const headerEnd = findPPMHeaderEnd(raw);
  const headerStr = raw.slice(0, headerEnd).toString('ascii');
  const [, wStr, hStr] = headerStr.match(/P6\s+(\d+)\s+(\d+)\s+\d+/)!;
  const width = parseInt(wStr);
  const height = parseInt(hStr);
  const pixels = raw.slice(headerEnd);

  return { width, height, pixels };
}

function findPPMHeaderEnd(buf: Buffer): number {
  // Header ends after the third whitespace-terminated token
  let tokenCount = 0;
  let i = 0;
  while (i < buf.length) {
    // Skip whitespace / comments
    while (i < buf.length && (buf[i] <= 32 || buf[i] === 35)) {
      if (buf[i] === 35) { // '#' — skip comment line
        while (i < buf.length && buf[i] !== 10) i++;
      }
      i++;
    }
    // Read token
    const start = i;
    while (i < buf.length && buf[i] > 32) i++;
    if (i > start) tokenCount++;
    if (tokenCount === 3) {
      // Skip exactly one whitespace byte after the third token
      return i + 1;
    }
  }
  throw new Error('Malformed PPM header');
}

/**
 * Delete a list of files. Ignores errors (best-effort /tmp cleanup).
 */
export async function cleanupFiles(paths: string[]): Promise<void> {
  await Promise.allSettled(paths.map(p => unlink(p)));
}
