// Core rhythm engine. Maintains:
//   - targetBPM (drifts over time via scheduled events)
//   - currentBPM (estimated from recent taps)
//   - lastTapAt, nextExpectedAt — beat timing
//   - status: alive | critical | flatline | vfib
//   - combo, score, life seconds, beat history (for ECG)
//
// External UI calls tap() on every player pointerdown. Engine emits onTap
// with quality, onDeath when the patient is lost.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PatientStatus, TapQuality } from '../types';
import { bleep as audioBleep } from '../utils/audio';

export interface BeatMark {
  at: number;          // performance.now()
  quality: TapQuality;
  strength: number;    // 0..1, for ECG R-wave amplitude
}

export interface HeartbeatState {
  status: PatientStatus;
  targetBPM: number;
  currentBPM: number;
  combo: number;
  bestCombo: number;
  perfectCount: number;
  goodCount: number;
  totalTaps: number;
  lifeSeconds: number;
  lastQuality: TapQuality;
  score: number;
  spO2: number;        // 88..99 — drops with combo break / status
  systolic: number;    // 60..130
  diastolic: number;   // 40..85
  events: string[];    // last few event labels for HUD
  missedInARow: number; // 0..decayThreshold-1; drives urgency UI
}

export interface UseHeartbeatOptions {
  enabled: boolean;
  onDeath?: (cause: 'flatline' | 'vfib', state: HeartbeatState) => void;
  onTap?: (quality: TapQuality, mark: BeatMark) => void;
  graceMs?: number;    // initial grace window where misses don't count
}

const DEFAULTS = {
  perfectWindow: 90,    // ±ms from expected — eased from 65 in v0.8
  goodWindow: 180,      // eased from 130
  offWindow: 320,       // eased from 250
  missGraceMs: 750,     // eased from 600
  decayThreshold: 5,    // up from 4 — one extra forgiveness beat
  vfibThreshold: 5,     // taps within 700ms → vfib (unchanged)
};

// Survival eligibility — tap to RELEASE when both met.
export const RELEASE_LIFE_SECONDS = 50;
export const RELEASE_BEST_COMBO   = 12;

export function useHeartbeat(opts: UseHeartbeatOptions) {
  const [state, setState] = useState<HeartbeatState>({
    status: 'alive',
    targetBPM: 60,
    currentBPM: 60,
    combo: 0,
    bestCombo: 0,
    perfectCount: 0,
    goodCount: 0,
    totalTaps: 0,
    lifeSeconds: 0,
    lastQuality: null,
    score: 0,
    spO2: 99,
    systolic: 118,
    diastolic: 76,
    events: [],
    missedInARow: 0,
  });

  const [beats, setBeats] = useState<BeatMark[]>([]);

  // Mutable refs for the RAF loop and event scheduler
  const r = useRef({
    startedAt: 0,
    lastTapAt: 0,
    nextExpectedAt: 0,
    missedInARow: 0,
    targetBPM: 60,
    status: 'alive' as PatientStatus,
    combo: 0,
    bestCombo: 0,
    perfectCount: 0,
    goodCount: 0,
    totalTaps: 0,
    score: 0,
    tapWindow: [] as number[],     // recent tap timestamps (for too-fast detection)
    tapDeltas: [] as number[],     // recent tap-to-tap intervals (for BPM estimate)
    enabled: false,
    eventTimer: 0,
    lastTickedAt: 0,               // last metronome cue time
    bpmDriftActive: false,
    bpmDriftEnd: 0,
    bpmDriftFrom: 60,
    bpmDriftTo: 60,
    bpmDriftStart: 0,
    spO2: 99,
    systolic: 118,
    diastolic: 76,
    events: [] as string[],
  });

  // Keep enabled in sync
  useEffect(() => { r.current.enabled = opts.enabled; }, [opts.enabled]);

  const die = useCallback((cause: 'flatline' | 'vfib') => {
    if (r.current.status === 'flatline' || r.current.status === 'vfib') return;
    r.current.status = cause;
    setState((s) => ({ ...s, status: cause }));
    opts.onDeath?.(cause, {
      status: cause,
      targetBPM: r.current.targetBPM,
      currentBPM: 0,
      combo: r.current.combo,
      bestCombo: r.current.bestCombo,
      perfectCount: r.current.perfectCount,
      goodCount: r.current.goodCount,
      totalTaps: r.current.totalTaps,
      lifeSeconds: Math.max(0, (performance.now() - r.current.startedAt) / 1000),
      lastQuality: null,
      score: r.current.score,
      spO2: 0,
      systolic: 0,
      diastolic: 0,
      events: r.current.events.slice(),
      missedInARow: r.current.missedInARow,
    });
  }, [opts]);

  const reset = useCallback(() => {
    const now = performance.now();
    r.current.startedAt = now;
    r.current.lastTapAt = now;
    r.current.nextExpectedAt = now + 1500; // first beat expected in 1.5s — gentle ramp
    r.current.missedInARow = 0;
    r.current.targetBPM = 60;
    r.current.status = 'alive';
    r.current.combo = 0;
    r.current.bestCombo = 0;
    r.current.perfectCount = 0;
    r.current.goodCount = 0;
    r.current.totalTaps = 0;
    r.current.score = 0;
    r.current.tapWindow = [];
    r.current.tapDeltas = [];
    r.current.bpmDriftActive = false;
    r.current.lastTickedAt = 0;
    r.current.spO2 = 99;
    r.current.systolic = 118;
    r.current.diastolic = 76;
    r.current.events = [];
    r.current.eventTimer = now + 12000 + Math.random() * 5000; // first event 12-17s in
    setBeats([]);
    setState({
      status: 'alive',
      targetBPM: 60,
      currentBPM: 60,
      combo: 0,
      bestCombo: 0,
      perfectCount: 0,
      goodCount: 0,
      totalTaps: 0,
      lifeSeconds: 0,
      lastQuality: null,
      score: 0,
      spO2: 99,
      systolic: 118,
      diastolic: 76,
      events: [],
      missedInARow: 0,
    });
  }, []);

  // Reset whenever enabled flips to true (game start)
  useEffect(() => {
    if (opts.enabled) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  // RAF loop — drives target-BPM drift, decay/death checks, vitals updates
  useEffect(() => {
    if (!opts.enabled) return;
    let rafId = 0;
    let stopped = false;

    const tickFrame = () => {
      if (stopped) return;
      const now = performance.now();
      const st = r.current;

      if (st.status === 'alive' || st.status === 'critical') {
        // Advance BPM drift
        if (st.bpmDriftActive) {
          const t = Math.min(1, (now - st.bpmDriftStart) / (st.bpmDriftEnd - st.bpmDriftStart));
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          st.targetBPM = st.bpmDriftFrom + (st.bpmDriftTo - st.bpmDriftFrom) * eased;
          if (t >= 1) st.bpmDriftActive = false;
        }

        // Schedule next vital event
        if (now >= st.eventTimer) {
          const roll = Math.random();
          const cur = st.targetBPM;
          let toBPM: number;
          let durationMs: number;
          let label: string;
          if (roll < 0.28) {
            toBPM = 44 + Math.random() * 8;
            durationMs = 6000;
            label = 'BRADYCARDIA';
          } else if (roll < 0.52) {
            toBPM = 80 + Math.random() * 18;
            durationMs = 5000;
            label = 'TACHYCARDIA';
          } else if (roll < 0.82) {
            toBPM = 58 + Math.random() * 6;
            durationMs = 7000;
            label = 'STABILIZING';
          } else {
            toBPM = 105 + Math.random() * 25;
            durationMs = 3500;
            label = 'PANIC SURGE';
          }
          st.bpmDriftActive = true;
          st.bpmDriftStart = now;
          st.bpmDriftEnd = now + durationMs;
          st.bpmDriftFrom = cur;
          st.bpmDriftTo = toBPM;
          st.events.unshift(label);
          st.events = st.events.slice(0, 4);
          st.eventTimer = now + 13000 + Math.random() * 7000;
        }

        // Compute expected next beat in light of (possibly changing) targetBPM
        const beatIntervalMs = 60000 / st.targetBPM;

        // Bedside monitor bleep at each expected beat — the patient's own
        // heart audible. Pitch + volume shift slightly with current vitals so
        // a tachy patient sounds tighter, a brady one duller.
        if (
          st.lastTickedAt < st.nextExpectedAt &&
          now >= st.nextExpectedAt &&
          now - st.startedAt > 1500
        ) {
          // Pitch range: 660Hz at 40 BPM → 980Hz at 130 BPM
          const pitch = 660 + Math.min(1, Math.max(0, (st.targetBPM - 40) / 90)) * 320;
          const vol = st.status === 'critical' ? 0.13 : 0.08;
          audioBleep(pitch, vol);
          st.lastTickedAt = st.nextExpectedAt;
        }

        // If we've blown past nextExpectedAt by enough, count missed beats
        const overdue = now - st.nextExpectedAt;
        if (overdue > DEFAULTS.missGraceMs) {
          // Treat as missed; shift the expected beat forward by one interval
          st.missedInARow += 1;
          st.combo = 0;
          st.nextExpectedAt += beatIntervalMs;
          if (st.missedInARow >= DEFAULTS.decayThreshold) {
            die('flatline');
          }
        }

        // Status: critical when 2+ missed in a row
        const newStatus: PatientStatus =
          st.missedInARow >= 2 ? 'critical' : 'alive';
        if (newStatus !== st.status) st.status = newStatus;

        // Vitals decay (purely cosmetic — slow drift toward stress)
        const stress = Math.min(1, st.missedInARow / 4);
        st.spO2 = clamp(99 - stress * 12, 78, 99);
        st.systolic = clamp(
          118 - stress * 38 + (st.targetBPM > 95 ? 6 : 0),
          70,
          150,
        );
        st.diastolic = clamp(76 - stress * 28, 40, 95);

        // Estimate current BPM from last few tap intervals
        const recent = st.tapDeltas.slice(-4);
        let estBPM = st.targetBPM;
        if (recent.length >= 2) {
          const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
          if (avg > 0) estBPM = Math.round(60000 / avg);
        }

        // Push state for render every frame
        setState({
          status: st.status,
          targetBPM: Math.round(st.targetBPM),
          currentBPM: clamp(estBPM, 0, 220),
          combo: st.combo,
          bestCombo: st.bestCombo,
          perfectCount: st.perfectCount,
          goodCount: st.goodCount,
          totalTaps: st.totalTaps,
          lifeSeconds: Math.max(0, (now - st.startedAt) / 1000),
          lastQuality: null, // last quality is cleared by render-frame
          score: Math.round(st.score),
          spO2: Math.round(st.spO2),
          systolic: Math.round(st.systolic),
          diastolic: Math.round(st.diastolic),
          events: st.events.slice(),
          missedInARow: st.missedInARow,
        });
      }

      rafId = requestAnimationFrame(tickFrame);
    };

    rafId = requestAnimationFrame(tickFrame);
    return () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [opts.enabled, die]);

  const tap = useCallback(() => {
    const st = r.current;
    if (!st.enabled) return null;
    if (st.status !== 'alive' && st.status !== 'critical') return null;

    const now = performance.now();
    const beatIntervalMs = 60000 / st.targetBPM;
    const delta = now - st.nextExpectedAt;
    const absDelta = Math.abs(delta);

    let quality: TapQuality;
    let strength = 0.55;
    let scoreGain = 0;
    if (absDelta <= DEFAULTS.perfectWindow) {
      quality = 'perfect';
      strength = 1;
      scoreGain = 50 + st.combo * 2;
      st.perfectCount += 1;
      st.combo += 1;
    } else if (absDelta <= DEFAULTS.goodWindow) {
      quality = 'good';
      strength = 0.7;
      scoreGain = 25 + st.combo;
      st.goodCount += 1;
      st.combo += 1;
    } else if (absDelta <= DEFAULTS.offWindow) {
      quality = delta < 0 ? 'early' : 'late';
      strength = 0.45;
      scoreGain = 5;
      st.combo = 0;
    } else {
      // Way off — only count if patient is overdue, otherwise treat as
      // panicky button-mashing (no scoring, but DOES add to tooFast window).
      quality = 'off';
      strength = 0.35;
      scoreGain = 0;
      st.combo = 0;
    }

    st.score += scoreGain;
    st.bestCombo = Math.max(st.bestCombo, st.combo);
    st.totalTaps += 1;
    st.missedInARow = 0;

    if (st.lastTapAt > 0) {
      const dt = now - st.lastTapAt;
      st.tapDeltas.push(dt);
      if (st.tapDeltas.length > 8) st.tapDeltas.shift();
    }
    st.lastTapAt = now;
    // Advance the metronome grid by one beat from the CURRENT expected
    // beat (not from the tap time). This keeps the rhythm grid stable
    // regardless of where the player landed within the window — the
    // patient's heart doesn't reset every time you touch them.
    st.nextExpectedAt += beatIntervalMs;

    // V-fib detector: track tap timestamps in last 700ms; > threshold = vfib
    st.tapWindow.push(now);
    while (st.tapWindow.length && now - st.tapWindow[0] > 700) st.tapWindow.shift();
    if (st.tapWindow.length >= DEFAULTS.vfibThreshold) {
      die('vfib');
    }

    const mark: BeatMark = { at: now, quality, strength };
    setBeats((b) => {
      const next = [...b, mark];
      // Keep last 30 marks max — ECG render only needs visible ones
      if (next.length > 30) next.splice(0, next.length - 30);
      return next;
    });

    // Push the lastQuality flash so UI can render hit-feedback
    setState((s) => ({ ...s, lastQuality: quality }));
    opts.onTap?.(quality, mark);

    return quality;
  }, [opts, die]);

  return { state, beats, tap, reset };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
