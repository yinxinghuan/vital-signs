// Secondary SpO₂ plethysmograph wave. Smooth sinusoidal pulse, decoupled from
// the player's tap rhythm — driven by the heart engine's targetBPM so it
// "lives" alongside the ECG and visually thickens the bedside-monitor feel.

import { useEffect, useRef } from 'react';
import type { PatientStatus } from '../types';

interface Props {
  status: PatientStatus;
  bpm: number;
  /** Optional fixed height in px. If omitted, canvas fills its parent (100%). */
  height?: number;
  pxPerSec?: number;
}

export default function PlethCanvas({ status, bpm, height, pxPerSec = 90 }: Props) {
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
      const baselineY = H * 0.65;

      ctx.fillStyle = '#040605';
      ctx.fillRect(0, 0, W, H);

      // Faint grid
      ctx.strokeStyle = '#0a1814';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let y = 0; y < H; y += 12) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();

      const lethal = status === 'flatline' || status === 'vfib';
      const color = lethal ? '#5a3a3a' : '#5fdcff';
      const glow = lethal ? '#3a1a1a' : '#0d4258';

      ctx.lineWidth = 1.6;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 5;
      ctx.shadowColor = glow;
      ctx.beginPath();
      // The pleth wave: sharp rise + slow falloff (dicrotic notch echoed)
      // beat period = 60000/bpm
      const period = 60000 / Math.max(20, bpm);
      const amp = lethal ? 2 : H * 0.32;
      const step = 2;
      let drawing = false;
      for (let x = 0; x <= W; x += step) {
        const tAgo = (W - x) / pxMs;
        const tAt = now - tAgo;
        const phase = ((tAt % period) / period); // 0..1 within heartbeat

        let y = baselineY;
        if (!lethal) {
          // Build a pleth-style envelope: fast up ramp, decay, dicrotic dip
          let env: number;
          if (phase < 0.18) {
            const u = phase / 0.18;
            env = Math.pow(u, 0.6); // fast rise
          } else if (phase < 0.42) {
            const u = (phase - 0.18) / 0.24;
            env = 1 - 0.55 * u; // initial decay
          } else if (phase < 0.52) {
            // dicrotic notch bump
            const u = (phase - 0.42) / 0.1;
            env = 0.45 + 0.12 * Math.sin(u * Math.PI);
          } else {
            const u = (phase - 0.52) / 0.48;
            env = 0.45 * (1 - u);
          }
          y = baselineY - env * amp;
          // tiny noise
          y += (Math.random() - 0.5) * 0.6;
        } else {
          y += (Math.random() - 0.5) * (status === 'vfib' ? 10 : 0.4);
        }
        if (!drawing) { ctx.moveTo(x, y); drawing = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [status, bpm, pxPerSec]);

  return (
    <canvas
      ref={canvasRef}
      className="vs-pleth__canvas"
      style={{ width: '100%', height: height ? `${height}px` : '100%', display: 'block' }}
    />
  );
}
