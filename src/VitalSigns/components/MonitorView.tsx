// CCTV-style patient monitor. Replaces the round avatar PatientCard on the
// playing screen — 4:3 framed display with bezel chrome, REC indicator,
// scanlines, info bars top and bottom, and cross-fade between portrait
// variants (stable / critical / lethal) when state changes.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { PatientStatus, Patient } from '../types';
import { pickPortrait, type PortraitVariant } from '../hooks/useResuscitationPortrait';

interface Props {
  patient: Patient;
  status: PatientStatus;
  missedInARow: number;
  bpm: number;
  elapsedSeconds: number;
  variants: Record<PortraitVariant, string | null>;
  frameRef?: React.RefObject<HTMLDivElement>;
  dimmed?: boolean;
}

function chooseVariant(status: PatientStatus, missedInARow: number): PortraitVariant {
  if (status === 'flatline' || status === 'vfib') return 'lethal';
  if (status === 'critical' || missedInARow >= 2) return 'critical';
  return 'stable';
}

function fmtRecClock(elapsed: number): string {
  const baseSec = 2 * 3600 + 31 * 60;
  const total = baseSec + Math.floor(elapsed);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export default function MonitorView({ patient, status, missedInARow, bpm, elapsedSeconds, variants, frameRef, dimmed }: Props) {
  const requested = chooseVariant(status, missedInARow);
  const activeUrl = pickPortrait(variants, requested);
  const initials = useMemo(() => (patient.name || patient.telegram_id || '?').slice(0, 2).toUpperCase(), [patient]);
  const pid = useMemo(() => {
    let h = 5381;
    const s = patient.telegram_id || patient.name || 'x';
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return (h % 9000 + 1000).toString();
  }, [patient]);

  // Glitch flash on variant transition
  const [glitchKey, setGlitchKey] = useState(0);
  const lastVariant = useRef<PortraitVariant>(requested);
  useEffect(() => {
    if (lastVariant.current !== requested) {
      lastVariant.current = requested;
      setGlitchKey((k) => k + 1);
    }
  }, [requested]);

  const breathSec = bpm ? Math.max(2.2, (60 / bpm) * 6) : 4;
  const statusClass = `is-${status}`;
  const variantClass = `is-${requested}`;

  return (
    <div className={`vs-monitor ${dimmed ? 'is-dimmed' : ''} ${statusClass} ${variantClass}`} ref={frameRef}>
      {/* Bezel chrome */}
      <div className="vs-monitor__bezel">
        <div className="vs-monitor__screen" style={{ ['--vs-breath' as any]: `${breathSec}s` }}>
          <div className="vs-monitor__signal">
            {activeUrl ? (
              <img
                key={activeUrl}
                src={activeUrl}
                alt=""
                className="vs-monitor__img"
                draggable={false}
                referrerPolicy="no-referrer"
              />
            ) : patient.head_url ? (
              <img
                src={patient.head_url}
                alt=""
                className="vs-monitor__imgRaw"
                draggable={false}
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="vs-monitor__placeholder">{initials}</div>
            )}
            {/* CRT overlays */}
            <div className="vs-monitor__scan" />
            <div className="vs-monitor__bloom" />
            <div className="vs-monitor__vignette" />
            {/* Glitch flash on variant swap */}
            <div key={glitchKey} className="vs-monitor__glitch" />
          </div>

          {/* Top bar — REC indicator + camera label */}
          <div className="vs-monitor__topbar">
            <span className="vs-monitor__rec">
              <span className="vs-monitor__recDot" />
              <span>REC</span>
            </span>
            <span className="vs-monitor__camLabel">CAM 02 · BED 03</span>
            <span className="vs-monitor__clock">{fmtRecClock(elapsedSeconds)}</span>
          </div>

          {/* Bottom bar — patient info */}
          <div className="vs-monitor__bottombar">
            <span className="vs-monitor__pid">VS-{pid}</span>
            <span className="vs-monitor__sep">·</span>
            <span className="vs-monitor__ward">03 / DREAM</span>
            <span className="vs-monitor__sep">·</span>
            <span className="vs-monitor__name">@{patient.name || patient.telegram_id}</span>
          </div>

          {/* IV drip on the edge */}
          <div className="vs-monitor__iv" aria-hidden>
            <div className="vs-monitor__ivLine" />
            <div className="vs-monitor__ivDrop" />
          </div>

          {/* No-signal scrolling bar (visible on glitch / no portrait) */}
          {!activeUrl && (
            <div className="vs-monitor__noSignal">
              <div className="vs-monitor__noSignalBar" />
              <div className="vs-monitor__noSignalTxt">RECEIVING…</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
