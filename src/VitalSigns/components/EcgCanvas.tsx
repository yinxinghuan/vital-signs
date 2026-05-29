// ECG canvas. Scrolls right-to-left at a fixed pixel-per-second rate.
// - "now" is pinned to the rightmost pixel.
// - Each BeatMark draws an R-wave spike at its timestamp's x-position.
// - status=flatline → no spikes, baseline only.
// - status=vfib → chaotic noise overlay.

import { useEffect, useRef } from 'react';
import type { BeatMark } from '../hooks/useHeartbeat';
import type { PatientStatus } from '../types';

interface Props {
  beats: BeatMark[];
  status: PatientStatus;
  /** Optional fixed height in px. If omitted, canvas fills its parent (100%). */
  height?: number;
  pxPerSec?: number;
}

const COLORS = {
  bg: '#040605',
  grid: '#0a1a14',
  gridStrong: '#0e2419',
  baseline: '#1e3a2f',
  trace: '#7fffaf',
  traceGlow: '#1f8a5a',
  vfib: '#ff6b6b',
};

export default function EcgCanvas({ beats, status, height = 180, pxPerSec = 130 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    let stopped = false;

    const resize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const rect = c.getBoundingClientRect();
      c.width = Math.floor(rect.width * dpr);
      c.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);

    const render = () => {
      if (stopped) return;
      const rect = c.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const now = performance.now();
      const pxMs = pxPerSec / 1000;
      const baselineY = H * 0.5;

      // Clear
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);

      // Grid (faint)
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      const gridSpacing = 18;
      for (let x = (now * pxMs) % gridSpacing; x < W; x += gridSpacing) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 0; y < H; y += gridSpacing) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();

      // Stronger grid every 5 cells
      ctx.strokeStyle = COLORS.gridStrong;
      ctx.beginPath();
      const gridStrong = gridSpacing * 5;
      for (let x = (now * pxMs) % gridStrong; x < W; x += gridStrong) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      ctx.stroke();

      // The waveform — composite of baseline + R-wave segments
      const traceColor = status === 'vfib' ? COLORS.vfib : COLORS.trace;
      const glowColor = status === 'vfib' ? COLORS.vfib : COLORS.traceGlow;

      ctx.lineWidth = 2;
      ctx.strokeStyle = traceColor;
      ctx.shadowBlur = 6;
      ctx.shadowColor = glowColor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      // Step along x from left to right; for each x, pick the y from
      // baseline + R-wave contribution + tiny ambient noise.
      const noiseAmp = status === 'flatline' ? 0.4 : status === 'vfib' ? 18 : 1.2;

      // Pre-filter beats by visibility window
      const visibleBeats = beats.filter((b) => {
        const x = W - (now - b.at) * pxMs;
        return x > -40 && x < W + 40;
      });

      let drawing = false;
      const step = 2; // px stride for smoothness vs perf
      for (let x = 0; x <= W; x += step) {
        // Time at this x (ms ago)
        const tAgo = (W - x) / pxMs;
        const tAt = now - tAgo;

        let y = baselineY;
        if (status !== 'flatline') {
          // Drifty baseline wiggle
          y += Math.sin((tAt * 0.012) % (Math.PI * 2)) * 0.8;
          y += (Math.random() - 0.5) * noiseAmp;
        }

        if (status !== 'flatline') {
          for (const b of visibleBeats) {
            const dxMs = tAt - b.at;
            // R-wave shape: tiny dip, sharp up, sharp down, slight bounce
            // total duration ~ 140ms
            const ampPx = 70 * b.strength;
            const downPx = 22 * b.strength;
            const reboundPx = 16 * b.strength;
            // shape phases (centered around b.at)
            if (dxMs >= -30 && dxMs <= 110) {
              if (dxMs < -15) {
                // Q dip: small downward at -30..-15ms
                const tt = (dxMs + 30) / 15; // 0..1
                y += downPx * 0.15 * Math.sin(tt * Math.PI);
              } else if (dxMs < 5) {
                // R sharp up: -15..+5ms
                const tt = (dxMs + 15) / 20;
                y -= ampPx * Math.sin(tt * Math.PI * 0.5);
              } else if (dxMs < 25) {
                // R sharp down (negative dip): 5..25ms
                const tt = (dxMs - 5) / 20;
                y -= ampPx * (1 - tt);
                y += downPx * tt;
              } else if (dxMs < 110) {
                // T wave rebound: 25..110ms
                const tt = (dxMs - 25) / 85;
                y += reboundPx * Math.sin(tt * Math.PI) * 0.4;
              }
            }
          }
        }

        if (!drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Status overlays
      if (status === 'flatline') {
        // Already drew a flat noisy line — add a faint pulsing label
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 80, 80, 0.85)';
        ctx.font = '10px IBM Plex Mono, monospace';
        const alpha = 0.6 + 0.4 * Math.sin(now / 250);
        ctx.globalAlpha = alpha;
        ctx.fillText('ASYSTOLE', 12, H - 12);
        ctx.globalAlpha = 1;
      } else if (status === 'vfib') {
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(255, 120, 120, 0.85)';
        ctx.font = '10px IBM Plex Mono, monospace';
        const alpha = 0.5 + 0.5 * Math.sin(now / 120);
        ctx.globalAlpha = alpha;
        ctx.fillText('V-FIB', 12, H - 12);
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [beats, status, pxPerSec]);

  return (
    <canvas
      ref={canvasRef}
      className="vs-ecg__canvas"
      style={{ width: '100%', height: height ? `${height}px` : '100%', display: 'block' }}
    />
  );
}
