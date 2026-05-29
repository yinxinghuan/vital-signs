// HUD — bedside-monitor style readouts above the ECG.
// Big BPM digits, vitals row, combo, life-elapsed.

import type { HeartbeatState } from '../hooks/useHeartbeat';
import { RELEASE_LIFE_SECONDS, RELEASE_BEST_COMBO } from '../hooks/useHeartbeat';

interface Props {
  state: HeartbeatState;
  patientName: string;
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

export default function Hud({ state, patientName }: Props) {
  const lethal = state.status === 'flatline' || state.status === 'vfib';
  const critical = state.status === 'critical';

  return (
    <div className={`vs-hud ${lethal ? 'is-lethal' : ''} ${critical ? 'is-critical' : ''}`}>
      <div className="vs-hud__top">
        <div className="vs-hud__patient">
          <span className="vs-hud__label">PATIENT</span>
          <span className="vs-hud__patientName">{patientName || '—'}</span>
        </div>
        <div className="vs-hud__time">
          <span className="vs-hud__label">ELAPSED</span>
          <span className="vs-hud__timeVal">{fmtTime(state.lifeSeconds)}</span>
        </div>
      </div>

      <div className="vs-hud__main">
        <div className="vs-hud__bpm">
          <div className="vs-hud__bpmLabel">HR</div>
          <div className="vs-hud__bpmValue">
            {state.status === 'flatline' ? '0' : state.status === 'vfib' ? '— —' : state.currentBPM}
          </div>
          <div className="vs-hud__bpmUnit">bpm</div>
        </div>

        <div className="vs-hud__targetWrap">
          <div className="vs-hud__targetLabel">TARGET</div>
          <div className="vs-hud__target">{state.targetBPM}</div>
        </div>

        <div className="vs-hud__vitalsCol">
          <div className="vs-hud__vital">
            <span className="vs-hud__label">SpO₂</span>
            <span className="vs-hud__vitalVal">{state.status === 'flatline' ? '— —' : `${state.spO2}%`}</span>
          </div>
          <div className="vs-hud__vital">
            <span className="vs-hud__label">BP</span>
            <span className="vs-hud__vitalVal">
              {state.status === 'flatline' ? '— —' : `${state.systolic}/${state.diastolic}`}
            </span>
          </div>
        </div>
      </div>

      <div className="vs-hud__bottom">
        <div className="vs-hud__score">
          <span className="vs-hud__label">SCORE</span>
          <span className="vs-hud__scoreVal">{state.score.toString().padStart(5, '0')}</span>
        </div>
        {state.combo >= 4 && (
          <div className="vs-hud__combo">×{state.combo}</div>
        )}
        <div className="vs-hud__event">{state.events[0] || 'STEADY'}</div>
      </div>

      <RevivalProgress
        lifeSeconds={state.lifeSeconds}
        bestCombo={state.bestCombo}
        canRelease={
          state.lifeSeconds >= RELEASE_LIFE_SECONDS &&
          state.bestCombo >= RELEASE_BEST_COMBO &&
          state.status === 'alive'
        }
      />
    </div>
  );
}

function RevivalProgress({ lifeSeconds, bestCombo, canRelease }: {
  lifeSeconds: number; bestCombo: number; canRelease: boolean;
}) {
  const timePct = Math.min(1, lifeSeconds / RELEASE_LIFE_SECONDS) * 100;
  const comboPct = Math.min(1, bestCombo / RELEASE_BEST_COMBO) * 100;
  const timeRem = Math.max(0, RELEASE_LIFE_SECONDS - lifeSeconds);
  const comboRem = Math.max(0, RELEASE_BEST_COMBO - bestCombo);

  return (
    <div className={`vs-hud__revival ${canRelease ? 'is-ready' : ''}`}>
      <div className="vs-hud__revivalLabel">
        {canRelease ? 'REVIVAL UNLOCKED' : 'REVIVAL'}
      </div>
      <div className="vs-hud__bar">
        <span className="vs-hud__barTag">TIME</span>
        <div className="vs-hud__barTrack">
          <div className="vs-hud__barFill" style={{ width: `${timePct}%` }} />
        </div>
        <span className="vs-hud__barRem">
          {canRelease || timeRem === 0 ? '✓' : `${Math.ceil(timeRem)}s`}
        </span>
      </div>
      <div className="vs-hud__bar">
        <span className="vs-hud__barTag">STREAK</span>
        <div className="vs-hud__barTrack">
          <div className="vs-hud__barFill" style={{ width: `${comboPct}%` }} />
        </div>
        <span className="vs-hud__barRem">
          {comboRem === 0 ? '✓' : `×${comboRem}`}
        </span>
      </div>
    </div>
  );
}
