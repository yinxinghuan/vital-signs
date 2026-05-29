// Death-approach urgency layer.
// Layered overlays that intensify as missedInARow climbs:
//   1. Red bottom-up flood vignette (opacity scales with missed count)
//   2. Right-edge alert chips swooping in (LOW SAT / BRADY / DESAT…)
//   3. Big "FLATLINE IN N" countdown (missedInARow ≥ 2)
//   4. Edge corner alarm brackets that pulse in from screen corners
//      when status is critical/flatline/vfib.

import { useEffect, useRef, useState } from 'react';
import type { PatientStatus } from '../types';

interface Props {
  status: PatientStatus;
  missedInARow: number;
  decayThreshold?: number;   // default 4 (must match engine)
}

const ALERT_POOL = [
  'LOW SAT',
  'BRADY',
  'DESAT',
  'CRASH CART',
  'ASYSTOLE',
  'CALL CODE',
  'ROUND-UP',
  'OXYGEN LOW',
  'NO PULSE',
  'PRESS HARDER',
];

interface Chip {
  id: number;
  text: string;
  laneTop: number;        // % from top
  laneDuration: number;   // ms
}

export default function CriticalFx({ status, missedInARow, decayThreshold = 4 }: Props) {
  const remaining = Math.max(0, decayThreshold - missedInARow);
  const lethal = status === 'flatline' || status === 'vfib';
  const cornerActive = status === 'critical' || lethal;

  const floodOp = lethal
    ? 0.7
    : Math.min(0.6, missedInARow * 0.18);

  // ─── Alert chips queue ───
  const [chips, setChips] = useState<Chip[]>([]);
  const nextId = useRef(0);

  useEffect(() => {
    if (missedInARow === 0 && !lethal) {
      setChips([]);
      return;
    }
    let mounted = true;
    const spawn = () => {
      if (!mounted) return;
      const id = nextId.current++;
      const text = ALERT_POOL[Math.floor(Math.random() * ALERT_POOL.length)];
      const laneTop = 18 + Math.random() * 32;   // 18%..50% from top
      const laneDuration = 1500 + Math.random() * 700;
      setChips((c) => [...c, { id, text, laneTop, laneDuration }]);
      setTimeout(() => {
        setChips((c) => c.filter((ch) => ch.id !== id));
      }, laneDuration + 100);
    };

    // First chip immediately, then on an interval that tightens with severity
    spawn();
    const interval = lethal ? 220 : Math.max(280, 900 - missedInARow * 180);
    const handle = setInterval(spawn, interval);
    return () => {
      mounted = false;
      clearInterval(handle);
    };
  }, [missedInARow, lethal]);

  return (
    <>
      <div
        className="vs-fx-flood"
        style={{ ['--vs-flood-op' as any]: floodOp }}
      />
      <div className={`vs-fx-corners ${cornerActive ? 'is-on' : ''}`} aria-hidden>
        <span /><span /><span /><span />
      </div>
      {chips.map((c) => (
        <div
          key={c.id}
          className="vs-fx-alert"
          style={{ top: `${c.laneTop}%`, animationDuration: `${c.laneDuration}ms` }}
        >
          <span className="vs-fx-alert__dot" />
          <span className="vs-fx-alert__txt">{c.text}</span>
        </div>
      ))}
      {missedInARow >= 2 && !lethal && (
        <div className="vs-fx-deathtimer">
          <span className="vs-fx-deathtimer__label">FLATLINE&nbsp;IN</span>
          <span className="vs-fx-deathtimer__num">{remaining}</span>
        </div>
      )}
    </>
  );
}
