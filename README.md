# Serve Sync v2

Auto-align tennis serve videos at the racket-ball contact point.
Upload 2–8 serve clips, compare them on a timeline, export synced side-by-side.

## Deploy

1. Push to GitHub
2. New project on [vercel.com](https://vercel.com)
3. Add environment variable: `BLOB_READ_WRITE_TOKEN` (from Vercel Blob storage)
4. Deploy

## Develop locally

```bash
npm install
# Create .env.local with:
# BLOB_READ_WRITE_TOKEN=your_token_here
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Architecture

- **Frontend** — Next.js App Router, React, hand-styled CSS (no UI library)
- **Backend** — Next.js API Routes, Vercel Blob storage, ffmpeg frame extraction
- **Detection** — Two-pass motion energy algorithm (no AI API)
  - Pass 1: coarse scan at 50ms intervals across 5s window
  - Pass 2: fine scan at 16ms intervals in ±0.3s around peak

## Agent ownership

| Area | Owner |
|------|-------|
| `src/app/api/**`, `src/lib/**` | Bacon |
| `src/components/**`, `src/app/page.tsx` | Kara |
| `src/types/index.ts`, `INTERFACE.md` | Shared |

See `BACON.md`, `KARA.md`, and `INTERFACE.md` for agent instructions.
