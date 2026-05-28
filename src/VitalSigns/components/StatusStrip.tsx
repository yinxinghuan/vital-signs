// Bedside-monitor top status strip. Mimics the LED indicator rail above
// a real ICU monitor — ALARM / LEAD / RHYTHM / PACER / clock readout.

import type { HeartbeatState } from '../hooks/useHeartbeat';

interface Props { state: HeartbeatState }

function rhythmLabel(state: HeartbeatState): { code: string; klass: string } {
  if (state.status === 'flatline') return { code: 'ASYS', klass: 'is-danger' };
  if (state.status === 'vfib') return { code: 'V-FIB', klass: 'is-danger' };
  if (state.targetBPM > 100) return { code: 'TACH', klass: 'is-warn' };
  if (state.targetBPM < 55) return { code: 'BRDY', klass: 'is-warn' };
  if (state.status === 'critical') return { code: 'PVC?', klass: 'is-warn' };
  return { code: 'NSR', klass: 'is-ok' };
}

function fmtClock(elapsed: number): string {
  // Anchor a fake ward clock at 02:31 + elapsed
  const baseSec = 2 * 3600 + 31 * 60;
  const totalSec = baseSec + Math.floor(elapsed);
  const h = Math.floor(totalSec / 3600) % 24;
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function StatusStrip({ state }: Props) {
  const rhythm = rhythmLabel(state);
  const alarmOn = state.status === 'critical' || state.status === 'flatline' || state.status === 'vfib';

  return (
    <div className="vs-strip">
      <div className={`vs-strip__cell vs-strip__alarm ${alarmOn ? 'is-on' : ''}`}>
        <span className="vs-strip__dot" />
        <span className="vs-strip__code">ALARM</span>
      </div>
      <div className="vs-strip__cell">
        <span className="vs-strip__codeDim">LEAD</span>
        <span className="vs-strip__code">II</span>
      </div>
      <div className={`vs-strip__cell ${rhythm.klass}`}>
        <span className="vs-strip__codeDim">RHY</span>
        <span className="vs-strip__code">{rhythm.code}</span>
      </div>
      <div className="vs-strip__cell">
        <span className="vs-strip__codeDim">PACE</span>
        <span className="vs-strip__code">OFF</span>
      </div>
      <div className="vs-strip__cell vs-strip__clock">{fmtClock(state.lifeSeconds)}</div>
    </div>
  );
}
