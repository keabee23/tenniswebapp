'use client';

import { useReducer, useRef, useCallback, useEffect } from 'react';
import type { Clip, ClipStatus } from '@/types';

// ─── State ────────────────────────────────────────────────────────────────────

interface ClipCard {
  id: string;               // local id before clipId assigned
  clipId: string;
  name: string;
  status: ClipStatus;
  blobUrl: string;
  duration: number;
  contactTime: number;
  confidence: number;
  thumbnailUrl: string;
  jobId: string;
  error: string;
}

type View = 'upload' | 'compare';

interface State {
  clips: ClipCard[];
  view: View;
  selected: [number, number] | null;  // indices into clips
  manualOffset: number;               // frames
  speedB: number;
  playing: boolean;
  scrubT: number;                     // seconds relative to contact (t=0)
}

type Action =
  | { type: 'ADD_CLIP'; card: ClipCard }
  | { type: 'UPDATE_CLIP'; id: string; patch: Partial<ClipCard> }
  | { type: 'REMOVE_CLIP'; id: string }
  | { type: 'SET_SELECTED'; selected: [number, number] }
  | { type: 'SET_VIEW'; view: View }
  | { type: 'SET_OFFSET'; delta: number }
  | { type: 'SET_SPEED_B'; speed: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_SCRUB'; t: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_CLIP':
      return { ...state, clips: [...state.clips, action.card] };
    case 'UPDATE_CLIP':
      return { ...state, clips: state.clips.map(c => c.id === action.id ? { ...c, ...action.patch } : c) };
    case 'REMOVE_CLIP':
      return { ...state, clips: state.clips.filter(c => c.id !== action.id) };
    case 'SET_SELECTED':
      return { ...state, selected: action.selected, view: 'compare', manualOffset: 0, speedB: 1, playing: false, scrubT: 0 };
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_OFFSET':
      return { ...state, manualOffset: state.manualOffset + action.delta };
    case 'SET_SPEED_B':
      return { ...state, speedB: action.speed };
    case 'SET_PLAYING':
      return { ...state, playing: action.playing };
    case 'SET_SCRUB':
      return { ...state, scrubT: action.t };
    default:
      return state;
  }
}

const INITIAL: State = {
  clips: [],
  view: 'upload',
  selected: null,
  manualOffset: 0,
  speedB: 1,
  playing: false,
  scrubT: 0,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() { return Math.random().toString(36).slice(2); }

function fmt(t: number) {
  const sign = t < 0 ? '−' : '+';
  const abs = Math.abs(t);
  return `${sign}${abs.toFixed(3)}s`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Page() {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const v1Ref = useRef<HTMLVideoElement>(null);
  const v2Ref = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Poll job status
  const pollJob = useCallback((localId: string, jobId: string) => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/status/${jobId}`);
      const data = await res.json();
      if (data.status === 'done') {
        clearInterval(interval);
        dispatch({ type: 'UPDATE_CLIP', id: localId, patch: {
          status: 'ready',
          contactTime: data.contactTime,
          confidence: data.confidence,
          thumbnailUrl: data.thumbnailUrl ?? '',
        }});
      } else if (data.status === 'failed') {
        clearInterval(interval);
        dispatch({ type: 'UPDATE_CLIP', id: localId, patch: { status: 'error', error: data.error } });
      }
    }, 1500);
  }, []);

  // Handle file input
  const handleFiles = useCallback(async (files: FileList) => {
    const toAdd = Array.from(files).slice(0, 8 - state.clips.length);
    for (const file of toAdd) {
      const localId = uid();
      dispatch({ type: 'ADD_CLIP', card: {
        id: localId, clipId: '', name: file.name,
        status: 'uploading', blobUrl: '', duration: 0,
        contactTime: 0, confidence: 0, thumbnailUrl: '', jobId: '', error: '',
      }});

      try {
        // Upload
        const form = new FormData();
        form.append('file', file);
        const upRes = await fetch('/api/upload', { method: 'POST', body: form });
        const upData = await upRes.json();
        if (!upRes.ok) throw new Error(upData.error);

        // Get duration from a temporary object URL
        const objUrl = URL.createObjectURL(file);
        const dur = await new Promise<number>((resolve) => {
          const v = document.createElement('video');
          v.preload = 'metadata';
          v.onloadedmetadata = () => { URL.revokeObjectURL(objUrl); resolve(v.duration); };
          v.src = objUrl;
        });

        dispatch({ type: 'UPDATE_CLIP', id: localId, patch: {
          clipId: upData.clipId, blobUrl: upData.blobUrl,
          duration: dur, status: 'detecting',
        }});

        // Detect
        const detRes = await fetch('/api/detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clipId: upData.clipId, blobUrl: upData.blobUrl, serveMark: null }),
        });
        const detData = await detRes.json();
        if (!detRes.ok) throw new Error(detData.error);

        dispatch({ type: 'UPDATE_CLIP', id: localId, patch: { jobId: detData.jobId } });
        pollJob(localId, detData.jobId);
      } catch (err: any) {
        dispatch({ type: 'UPDATE_CLIP', id: localId, patch: { status: 'error', error: err.message } });
      }
    }
  }, [state.clips.length, pollJob]);

  // Drag/drop
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  // Sync loop
  useEffect(() => {
    if (state.view !== 'compare' || !state.selected) return;
    const [i1, i2] = state.selected;
    const c1 = state.clips[i1];
    const c2 = state.clips[i2];
    if (!c1 || !c2) return;

    const v1 = v1Ref.current;
    const v2 = v2Ref.current;
    if (!v1 || !v2) return;

    if (!state.playing) {
      v1.pause(); v2.pause();
      v1.currentTime = c1.contactTime + state.scrubT + state.manualOffset * 0.5 / 30;
      v2.currentTime = c2.contactTime + state.scrubT * state.speedB - state.manualOffset * 0.5 / 30;
      return;
    }

    v1.play(); v2.play();

    const loop = () => {
      if (!state.playing) return;
      const t1 = v1.currentTime - c1.contactTime;
      const expectedV2 = c2.contactTime + t1 * state.speedB - state.manualOffset * 0.5 / 30;
      if (Math.abs(v2.currentTime - expectedV2) > 0.05) v2.currentTime = expectedV2;
      dispatch({ type: 'SET_SCRUB', t: t1 });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.playing, state.view, state.selected, state.scrubT, state.manualOffset, state.speedB]);

  // Export
  const handleExport = useCallback(() => {
    const v1 = v1Ref.current;
    const v2 = v2Ref.current;
    const canvas = canvasRef.current;
    if (!v1 || !v2 || !canvas) return;
    const w = v1.videoWidth || 480;
    const h = v1.videoHeight || 270;
    canvas.width = w; canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    // @ts-ignore
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      const a = document.createElement('a'); a.href = url; a.download = 'serve-sync.webm'; a.click();
    };

    const drawLoop = () => {
      ctx.drawImage(v1, 0, 0, w, h);
      ctx.drawImage(v2, 0, h, w, h);
      if (!v1.paused) requestAnimationFrame(drawLoop);
      else rec.stop();
    };

    rec.start();
    v1.play(); v2.play();
    drawLoop();
    setTimeout(() => { v1.pause(); v2.pause(); }, (v1.duration - v1.currentTime) * 1000);
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  const readyClips = state.clips.filter(c => c.status === 'ready');

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '0 14px 80px' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', paddingTop: 48, marginBottom: 24 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--g)' }}>Serve Sync</h1>
        <p style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--dim)', marginTop: 5 }}>
          Auto-align tennis serve videos
        </p>
      </div>

      {state.view === 'upload' ? (
        <>
          {/* Drop zone */}
          <label
            onDrop={onDrop}
            onDragOver={e => e.preventDefault()}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 8, padding: '32px 16px', borderRadius: 16,
              border: '2px dashed var(--bdr)', background: 'var(--card)',
              cursor: 'pointer', marginBottom: 16, minHeight: 120,
            }}
          >
            <input type="file" accept="video/*" multiple style={{ display: 'none' }}
              onChange={e => e.target.files && handleFiles(e.target.files)} />
            <span style={{ fontSize: 28 }}>🎾</span>
            <span style={{ fontSize: 13, color: 'var(--sub)' }}>
              {state.clips.length === 0 ? 'Upload 2–8 serve clips' : `${state.clips.length}/8 clips — tap to add more`}
            </span>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>MP4, MOV, WebM · max 100MB each</span>
          </label>

          {/* Clip cards */}
          {state.clips.map(c => (
            <div key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
              borderRadius: 12, background: 'var(--card)', border: '1.5px solid var(--bdr)',
              marginBottom: 8,
            }}>
              {/* Thumbnail or spinner */}
              <div style={{
                width: 48, height: 48, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
                background: 'rgba(255,255,255,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {c.thumbnailUrl
                  ? <img src={c.thumbnailUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                  : c.status === 'error'
                    ? <span style={{ fontSize: 20 }}>⚠️</span>
                    : <Spinner />
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                  {c.status === 'uploading' && 'Uploading…'}
                  {c.status === 'detecting' && 'Detecting contact…'}
                  {c.status === 'ready' && `Contact at ${c.contactTime.toFixed(3)}s · ${Math.round(c.confidence * 100)}% confidence`}
                  {c.status === 'error' && (c.error || 'Error')}
                </div>
              </div>
              <button onClick={() => dispatch({ type: 'REMOVE_CLIP', id: c.id })}
                style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18, padding: 4, minWidth: 44, minHeight: 44 }}>
                ×
              </button>
            </div>
          ))}

          {/* Compare CTA */}
          {readyClips.length >= 2 && (
            <div style={{ marginTop: 16 }}>
              <p style={{ fontSize: 12, color: 'var(--sub)', marginBottom: 10 }}>Select two clips to compare:</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {readyClips.map((c, i) =>
                  readyClips.slice(i + 1).map((c2, j) => (
                    <button
                      key={`${c.id}-${c2.id}`}
                      onClick={() => {
                        const i1 = state.clips.indexOf(c);
                        const i2 = state.clips.indexOf(c2);
                        dispatch({ type: 'SET_SELECTED', selected: [i1, i2] });
                      }}
                      style={{
                        padding: '10px 8px', borderRadius: 10,
                        background: 'rgba(52,211,153,0.08)', border: '1.5px solid rgba(52,211,153,0.2)',
                        color: 'var(--g)', fontSize: 11, fontWeight: 600, textAlign: 'center',
                      }}
                    >
                      {c.name.replace(/\.[^.]+$/, '')} vs {c2.name.replace(/\.[^.]+$/, '')}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        /* ─── Compare View ─────────────────────────────────────────────── */
        (() => {
          if (!state.selected) return null;
          const [i1, i2] = state.selected;
          const c1 = state.clips[i1];
          const c2 = state.clips[i2];
          if (!c1 || !c2) return null;

          const totalDur = Math.min(c1.duration - c1.contactTime, c2.duration - c2.contactTime);
          const scrubMin = -Math.min(c1.contactTime, c2.contactTime);
          const scrubMax = totalDur;

          return (
            <>
              <button onClick={() => dispatch({ type: 'SET_VIEW', view: 'upload' })}
                style={{ background: 'none', border: 'none', color: 'var(--sub)', fontSize: 13, marginBottom: 12, padding: '4px 0', minHeight: 44 }}>
                ← Back
              </button>

              {/* Videos */}
              <div style={{ borderRadius: 10, overflow: 'hidden', background: '#000', marginBottom: 2 }}>
                <video ref={v1Ref} src={c1.blobUrl} playsInline muted style={{ width: '100%', display: 'block' }} />
              </div>
              <div style={{ height: 2, background: state.playing ? 'var(--g)' : 'var(--bdr)' }} />
              <div style={{ borderRadius: 10, overflow: 'hidden', background: '#000', marginBottom: 12 }}>
                <video ref={v2Ref} src={c2.blobUrl} playsInline muted style={{ width: '100%', display: 'block' }} />
              </div>

              {/* Scrubber */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>t = {fmt(state.scrubT)}</span>
                  <span style={{ fontSize: 11, color: 'var(--dim)' }}>contact = 0</span>
                </div>
                <input type="range" min={scrubMin} max={scrubMax} step={0.016}
                  value={state.scrubT}
                  onChange={e => { dispatch({ type: 'SET_PLAYING', playing: false }); dispatch({ type: 'SET_SCRUB', t: parseFloat(e.target.value) }); }}
                  style={{ width: '100%', accentColor: 'var(--g)' }}
                />
              </div>

              {/* Controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                {/* Frame nudge */}
                <button onClick={() => dispatch({ type: 'SET_OFFSET', delta: -1 })}
                  style={btnStyle}>◀ 1f</button>

                {/* Play/pause */}
                <button onClick={() => dispatch({ type: 'SET_PLAYING', playing: !state.playing })}
                  style={{ ...btnStyle, flex: 1, background: 'var(--g)', color: 'var(--bg)', fontWeight: 700 }}>
                  {state.playing ? '⏸' : '▶'}
                </button>

                <button onClick={() => dispatch({ type: 'SET_OFFSET', delta: 1 })}
                  style={btnStyle}>1f ▶</button>
              </div>

              {/* Speed + export */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--sub)', flexShrink: 0 }}>P2 speed</span>
                {[0.25, 0.5, 1, 2, 4].map(s => (
                  <button key={s} onClick={() => dispatch({ type: 'SET_SPEED_B', speed: s })}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, border: '1.5px solid',
                      borderColor: state.speedB === s ? 'var(--g)' : 'var(--bdr)',
                      background: state.speedB === s ? 'rgba(52,211,153,0.1)' : 'var(--card)',
                      color: state.speedB === s ? 'var(--g)' : 'var(--sub)',
                      fontSize: 11, fontWeight: 600,
                    }}>
                    {s}×
                  </button>
                ))}
              </div>

              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 12 }}>
                Offset: {state.manualOffset > 0 ? '+' : ''}{state.manualOffset} frames
              </div>

              <button onClick={handleExport} style={{
                width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
                background: 'var(--g)', color: 'var(--bg)', fontSize: 14, fontWeight: 700,
              }}>
                Export synced video
              </button>
              <canvas ref={canvasRef} style={{ display: 'none' }} />
            </>
          );
        })()
      )}
    </main>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--bdr)',
  background: 'var(--card)', color: 'var(--text)', fontSize: 12, minHeight: 44,
};

function Spinner() {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      border: '2px solid rgba(52,211,153,0.15)',
      borderTopColor: 'var(--g)',
      animation: 'spin 0.7s linear infinite',
    }} />
  );
}
