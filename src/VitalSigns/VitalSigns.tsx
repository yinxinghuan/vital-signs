// VitalSigns — top-level component. Owns the phase machine + wires the
// rhythm engine, ECG render, HUD, Aigram patient picker. (LLM + wall
// come in later tasks.)

import { useCallback, useEffect, useRef, useState } from 'react';
import './VitalSigns.less';
import { useHeartbeat, RELEASE_LIFE_SECONDS, RELEASE_BEST_COMBO } from './hooks/useHeartbeat';
import { useAigramContacts, pickRandomPatient } from './hooks/useAigramContacts';
import { useDeathCertificate, type DeathCertificate as DCert } from './hooks/useDeathCertificate';
import { useFateWall } from './hooks/useFateWall';
import { useResuscitationPortraits } from './hooks/useResuscitationPortrait';
import { useGameSave } from '@shared/save';
import { useGameEvent } from '@shared/runtime';
import type { Patient, FateRecord, VitalSignsSave } from './types';
import EcgCanvas from './components/EcgCanvas';
import Hud from './components/Hud';
import FateWall from './components/FateWall';
import StatusStrip from './components/StatusStrip';
import PlethCanvas from './components/PlethCanvas';
import CriticalFx from './components/CriticalFx';
import MonitorView from './components/MonitorView';
import { t } from './i18n';
import * as audio from './utils/audio';

type Phase = 'splash' | 'playing' | 'dying' | 'certificate' | 'wall';

export default function VitalSigns() {
  const [phase, setPhase] = useState<Phase>('splash');
  const { contacts, loading: contactsLoading, isDemo } = useAigramContacts();
  const [patient, setPatient] = useState<Patient | null>(null);
  const audioUnlocked = useRef(false);

  // Demo URL hash routing
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    const m = hash.match(/demo=(\w+)/);
    if (m) {
      const p = m[1] as Phase;
      if (['splash', 'playing', 'dying', 'certificate', 'wall'].includes(p)) {
        setPhase(p);
      }
    }
  }, []);

  // Pick a random patient each time contacts load OR after reset
  useEffect(() => {
    if (!contactsLoading && !patient) {
      setPatient(pickRandomPatient(contacts));
    }
  }, [contactsLoading, contacts, patient]);

  const cert = useDeathCertificate();
  const save = useGameSave<VitalSignsSave>('vital-signs');
  const wall = useFateWall();
  const event = useGameEvent();
  const portraits = useResuscitationPortraits(patient);
  const persistedFateRef = useRef<string | null>(null);

  const newShift = useCallback(() => {
    cert.reset();
    persistedFateRef.current = null;
    setPatient(pickRandomPatient(contacts));
    setPhase('splash');
    wall.refresh();
  }, [contacts, cert, wall]);

  const heartbeatRef = useRef<{ state: { lifeSeconds: number; bestCombo: number } } | null>(null);

  const handleDeath = useCallback((cause: 'flatline' | 'vfib') => {
    if (cause === 'flatline') audio.flatline();
    else audio.vfib();
    setPhase('dying');

    // Kick off LLM + gen-image immediately — they may take 30–200s, the user
    // will sit on the dying screen for 2.6s and then watch the certificate
    // populate in place.
    const cur = heartbeatRef.current;
    if (patient && cur) {
      cert.generate({
        patient,
        lifeSeconds: cur.state.lifeSeconds,
        outcome: cause,
        bestCombo: cur.state.bestCombo,
      });
      // Platform event — fires backend notify to the friend whose dream
      // ended on the table tonight. Same pattern as Wake-Up / Tag You're It.
      event.trigger('patient_lost', {
        target_user_id: patient.telegram_id,
        outcome: cause,
        lifeSeconds: Math.floor(cur.state.lifeSeconds),
      });
    }

    setTimeout(() => {
      audio.stopSustained();
      setPhase('certificate');
    }, 2600);
  }, [cert, patient, event]);

  // Manual release — only available once the patient has stabilized.
  // Treated as a survival outcome.
  const releasePatient = useCallback(() => {
    if (phase !== 'playing') return;
    const cur = heartbeatRef.current;
    if (!patient || !cur) return;
    audio.thump(0.6);
    setPhase('dying'); // briefly show the "transition" frame
    cert.generate({
      patient,
      lifeSeconds: cur.state.lifeSeconds,
      outcome: 'survived',
      bestCombo: cur.state.bestCombo,
    });
    event.trigger('patient_saved', {
      target_user_id: patient.telegram_id,
      lifeSeconds: Math.floor(cur.state.lifeSeconds),
      bestCombo: cur.state.bestCombo,
    });
    setTimeout(() => setPhase('certificate'), 1200);
  }, [phase, patient, cert, event]);

  const { state, beats, tap, reset } = useHeartbeat({
    enabled: phase === 'playing',
    onDeath: handleDeath,
    onTap: (q) => {
      if (q === 'perfect') audio.thump(1);
      else if (q === 'good') audio.thump(0.75);
      else audio.thump(0.5);
    },
  });

  // Keep refs of latest state so handleDeath can read them at fire time.
  useEffect(() => { heartbeatRef.current = { state }; }, [state]);

  // Persist the fate AS SOON AS the death certificate JSON returns. The
  // morgue image URL streams in independently; we patch in whichever value
  // is present (it might still be null) and persist again if needed.
  useEffect(() => {
    if (phase !== 'certificate') return;
    if (!patient || !cert.certificate) return;
    const fateId = `${patient.telegram_id}-${Math.floor(state.lifeSeconds)}-${state.score}`;
    if (persistedFateRef.current === fateId) return;
    persistedFateRef.current = fateId;

    const record: FateRecord = {
      id: fateId,
      patientId: patient.telegram_id,
      patientName: patient.name,
      patientAvatarUrl: patient.head_url,
      outcome:
        state.status === 'vfib' ? 'vfib' :
        state.status === 'flatline' ? 'flatline' :
        'survived',
      lifeSeconds: Math.floor(state.lifeSeconds),
      bestCombo: state.bestCombo,
      score: state.score,
      cause: cert.certificate.cause,
      lastWords: cert.certificate.last_words,
      timeOfDeath: cert.certificate.time_of_death,
      verdict: cert.certificate.verdict,
      morgueImageUrl: cert.morgueUrl,
      createdAt: Date.now(),
      reactions: { candle: 0, salute: 0, rest: 0 },
    };

    const existing = save.savedData;
    const next: VitalSignsSave = {
      history: [record, ...(existing?.history ?? [])].slice(0, 24),
      totalShifts: (existing?.totalShifts ?? 0) + 1,
      totalSeconds: (existing?.totalSeconds ?? 0) + record.lifeSeconds,
    };
    save.persist(next);
  }, [phase, patient, cert.certificate, cert.morgueUrl, state.lifeSeconds, state.score, state.bestCombo, state.status, save]);

  // When the morgue image lands AFTER persistence, patch the freshest record.
  useEffect(() => {
    if (!cert.morgueUrl || !persistedFateRef.current || !save.savedData) return;
    const top = save.savedData.history[0];
    if (!top || top.id !== persistedFateRef.current) return;
    if (top.morgueImageUrl) return;
    const updated: VitalSignsSave = {
      ...save.savedData,
      history: [
        { ...top, morgueImageUrl: cert.morgueUrl },
        ...save.savedData.history.slice(1),
      ],
    };
    save.persist(updated);
  }, [cert.morgueUrl, save]);

  const startGame = useCallback(() => {
    if (!patient) return;
    if (!audioUnlocked.current) {
      audio.unlockAudio();
      audioUnlocked.current = true;
    }
    setPhase('playing');
  }, [patient]);

  const playRef = useRef<HTMLDivElement>(null);
  const patientFrameRef = useRef<HTMLDivElement>(null);

  const onTapZone = useCallback(() => {
    if (phase !== 'playing') return;
    const q = tap();
    if (!q) return;
    // Visual punch: classList toggle (no React re-render per tap)
    const cls = `vs--punch-${q}`;
    const el = playRef.current;
    const fr = patientFrameRef.current;
    if (el) {
      el.classList.remove('vs--punch-perfect', 'vs--punch-good', 'vs--punch-early', 'vs--punch-late', 'vs--punch-off');
      void el.offsetWidth; // force reflow → re-trigger animation
      el.classList.add(cls);
    }
    if (fr) {
      fr.classList.remove('is-jolt-strong', 'is-jolt-soft');
      void fr.offsetWidth;
      fr.classList.add(q === 'perfect' || q === 'good' ? 'is-jolt-strong' : 'is-jolt-soft');
    }
  }, [phase, tap]);

  // ─── Loading / empty state ───
  if (contactsLoading) {
    return (
      <div className="vs vs--loading">
        <div className="vs-loading__pulse" />
        <div className="vs-loading__txt">{t('load.connecting')}</div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="vs vs--empty">
        <div className="vs-empty__head">{t('empty.head')}</div>
        <div className="vs-empty__sub">{t('empty.sub1')}</div>
        <div className="vs-empty__sub">{t('empty.sub2')}</div>
      </div>
    );
  }

  // ─── Phase: splash ───
  if (phase === 'splash') {
    return (
      <div className="vs vs--splash" onPointerDown={startGame}>
        <AmbientOverlay />
        <div className="vs-splash__topcard">
          <MonitorView
            patient={patient}
            status="alive"
            missedInARow={0}
            bpm={60}
            elapsedSeconds={0}
            variants={portraits.variants}
            dimmed
          />
        </div>
        <div className="vs-splash__instructions">
          <div className="vs-splash__line">{t('splash.line1')}</div>
          <div className="vs-splash__line">{t('splash.line2')}</div>
        </div>
        <SplashDemoLoop />
        <div className="vs-splash__cta">
          <div className="vs-splash__ctaText">{t('splash.cta')}</div>
          <div className="vs-splash__ctaPulse" />
        </div>
        {isDemo && <div className="vs-splash__demoTag">{t('splash.demo')}</div>}
        <Watermark />
      </div>
    );
  }

  if (phase === 'dying') {
    return (
      <div className="vs vs--dying">
        <MonitorView
          patient={patient}
          status={state.status}
          missedInARow={state.missedInARow}
          bpm={state.targetBPM}
          elapsedSeconds={state.lifeSeconds}
          variants={portraits.variants}
        />
        <div className="vs-dying__msg">
          {state.status === 'vfib' ? t('die.vfib') : t('die.flatline')}
        </div>
        <Watermark />
      </div>
    );
  }

  if (phase === 'certificate') {
    const outcome: 'flatline' | 'vfib' | 'survived' =
      state.status === 'vfib' ? 'vfib' :
      state.status === 'flatline' ? 'flatline' :
      'survived';
    return (
      <Certificate
        patient={patient}
        lifeSeconds={Math.floor(state.lifeSeconds)}
        bestCombo={state.bestCombo}
        outcome={outcome}
        score={state.score}
        certificate={cert.certificate}
        morgueUrl={cert.morgueUrl}
        generating={cert.generating}
        certError={cert.certError}
        imageError={cert.imageError}
        onRestart={() => { reset(); newShift(); }}
        onWall={() => setPhase('wall')}
      />
    );
  }

  if (phase === 'wall') {
    return (
      <div className="vs vs--wallphase">
        <FateWall entries={wall.entries} loaded={wall.loaded} onBack={() => setPhase('certificate')} />
        <Watermark />
      </div>
    );
  }

  const statusClass =
    state.status === 'critical' ? 'is-critical' :
    state.status === 'flatline' ? 'is-flatline' :
    state.status === 'vfib' ? 'is-vfib' : '';

  // Combo tier — drives the screen-wide visual accumulation.
  // 0: 0-4 (none) · 1: 5-9 (warming) · 2: 10-19 (heated) · 3: 20+ (charged)
  const comboTier =
    state.combo >= 20 ? 3 :
    state.combo >= 10 ? 2 :
    state.combo >= 5  ? 1 : 0;

  return (
    <div
      ref={playRef}
      className={`vs vs--play ${statusClass} vs--combo-${comboTier}`}
      onPointerDown={onTapZone}
      data-combo={state.combo}
    >
      <AmbientOverlay />
      <div className="vs__edgeFlash" />
      <div className="vs__criticalStrobe" />
      <div className="vs__chromaShift" />
      <CriticalFx status={state.status} missedInARow={state.missedInARow} />
      <ComboGlow tier={comboTier} />
      <ComboShockwave combo={state.combo} />
      <ComboBadge combo={state.combo} tier={comboTier} />
      <StatusStrip state={state} />
      <MonitorView
        patient={patient}
        status={state.status}
        missedInARow={state.missedInARow}
        bpm={state.targetBPM}
        elapsedSeconds={state.lifeSeconds}
        variants={portraits.variants}
        frameRef={patientFrameRef}
      />
      <Hud state={state} patientName={patient.name || patient.telegram_id} />
      <div className="vs__monitor">
        <div className="vs__channel vs__channel--ecg">
          <div className="vs__channelLabel">
            <span>II</span>
            <span className="vs__channelGain">×1.0</span>
          </div>
          <EcgCanvas beats={beats} status={state.status} />
        </div>
        <div className="vs__channel vs__channel--pleth">
          <div className="vs__channelLabel">
            <span>SpO₂</span>
            <span className="vs__channelGain">{state.status === 'flatline' ? '— —' : `${state.spO2}%`}</span>
          </div>
          <PlethCanvas status={state.status} bpm={state.targetBPM} />
        </div>
      </div>
      <div className="vs__tapZone">
        <TargetRing targetBPM={state.targetBPM} status={state.status} />
        <div className="vs__tapHint">
          {state.totalTaps < 3 ? t('play.hint') : ''}
        </div>
        <TapFeedback quality={state.lastQuality} totalTaps={state.totalTaps} />
        <SparkBurst totalTaps={state.totalTaps} quality={state.lastQuality} tier={comboTier} />
        <div className="vs__tapZoneCorners">
          <span /><span /><span /><span />
        </div>
      </div>
      <ReleaseButton
        eligible={
          state.lifeSeconds >= RELEASE_LIFE_SECONDS &&
          state.bestCombo >= RELEASE_BEST_COMBO &&
          state.status === 'alive'
        }
        onRelease={(e) => { e.stopPropagation(); releasePatient(); }}
      />
      <Watermark />
    </div>
  );
}

function ComboGlow({ tier }: { tier: number }) {
  // Always-rendered overlay; intensity controlled by `vs--combo-N` parent class.
  return <div className={`vs__comboGlow tier-${tier}`} aria-hidden />;
}

function ComboShockwave({ combo }: { combo: number }) {
  // One-shot ring pulse fires whenever combo crosses a tier boundary (5/10/20).
  const lastTier = useRef(0);
  const [burstId, setBurstId] = useState(0);
  const [burstKind, setBurstKind] = useState<'small' | 'big' | 'max'>('small');

  useEffect(() => {
    const tier =
      combo >= 20 ? 3 :
      combo >= 10 ? 2 :
      combo >= 5  ? 1 : 0;
    if (tier > lastTier.current) {
      lastTier.current = tier;
      setBurstKind(tier >= 3 ? 'max' : tier >= 2 ? 'big' : 'small');
      setBurstId((n) => n + 1);
    } else if (tier < lastTier.current) {
      // combo reset — clear tier baseline so a re-cross fires again
      lastTier.current = tier;
    }
  }, [combo]);

  if (burstId === 0) return null;
  return <div key={burstId} className={`vs__shockwave is-${burstKind}`} aria-hidden />;
}

function ComboBadge({ combo, tier }: { combo: number; tier: number }) {
  if (tier < 2) return null;
  return (
    <div className={`vs__comboBadge tier-${tier}`} aria-hidden>
      <span className="vs__comboBadgeNum">×{combo}</span>
      <span className="vs__comboBadgeLabel">{tier >= 3 ? 'CHARGED' : 'STREAK'}</span>
    </div>
  );
}

function SparkBurst({ totalTaps, quality, tier }: { totalTaps: number; quality: ReturnType<typeof useHeartbeat>['state']['lastQuality']; tier: number }) {
  // Emit a burst at every tap; only render visible for perfect/good.
  // Combo tier inflates the spark count + travel distance.
  const [count, setCount] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    if (totalTaps === last.current) return;
    last.current = totalTaps;
    setCount((c) => c + 1);
  }, [totalTaps]);

  if (count === 0 || (quality !== 'perfect' && quality !== 'good')) return null;

  const base = quality === 'perfect' ? 8 : 5;
  const sparks = base + tier * 3; // 8/11/14/17 at perfect across tiers
  const dist = 56 + tier * 14;    // 56/70/84/98 px
  const klass = quality === 'perfect' ? 'is-perfect' : 'is-good';
  return (
    <div className={`vs-spark ${klass} tier-${tier}`} key={count} style={{ ['--dist' as any]: `${dist}px` }}>
      {Array.from({ length: sparks }).map((_, i) => (
        <span key={i} style={{ ['--angle' as any]: `${(360 / sparks) * i}deg` }} />
      ))}
    </div>
  );
}

function ReleaseButton({ eligible, onRelease }: { eligible: boolean; onRelease: (e: React.PointerEvent) => void }) {
  if (!eligible) return null;
  return (
    <button className="vs__release" onPointerDown={onRelease}>
      <span className="vs__releaseDot" />
      <span>{t('play.release')}</span>
    </button>
  );
}

function SplashDemoLoop() {
  // Demo ECG preview — looping synthetic beats at 60 BPM, runs until first
  // tap (entire splash unmounts). Per CLAUDE.md instant-play tutorial rule.
  const [beats, setBeats] = useState<{ at: number; quality: any; strength: number }[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const t = performance.now();
      setBeats((b) => [...b.slice(-5), { at: t, quality: 'perfect', strength: 1 }]);
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="vs-splash__demo">
      <div className="vs-splash__demoLabel">
        <span>II</span>
        <span className="vs-splash__demoBpm">60 bpm · target</span>
      </div>
      <EcgCanvas beats={beats} status="alive" height={68} pxPerSec={100} />
      <div className="vs-splash__demoRing" />
    </div>
  );
}

function AmbientOverlay() {
  return (
    <>
      <div className="vs-ambient vs-ambient--scan" />
      <div className="vs-ambient vs-ambient--vignette" />
      <div className="vs-ambient vs-ambient--noise" />
    </>
  );
}

// PatientCard removed in v0.7 — replaced by MonitorView. Patient identity
// chrome lives inside the monitor frame now (top/bottom bars + IV).

function TargetRing({ targetBPM, status }: { targetBPM: number; status: string }) {
  // CSS pulse cue synchronized to the patient's current target BPM.
  // Duration goes through a CSS var so the punch-shake CSS rules can override
  // animation-name+duration cleanly (inline `animationDuration` would win
  // against the shake rule and slow the shake to BPM speed).
  const durationMs = 60000 / Math.max(20, targetBPM);
  const isLethal = status === 'flatline' || status === 'vfib';
  return (
    <div
      className={`vs-target ${isLethal ? 'is-lethal' : ''}`}
      style={{ ['--vs-target-dur' as any]: `${durationMs}ms` }}
      key={Math.round(targetBPM / 5)}
    />
  );
}

function TapFeedback({ quality, totalTaps }: { quality: ReturnType<typeof useHeartbeat>['state']['lastQuality']; totalTaps: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const lastTotalRef = useRef(0);

  useEffect(() => {
    if (!quality) return;
    if (totalTaps === lastTotalRef.current) return;
    lastTotalRef.current = totalTaps;
    const label =
      quality === 'perfect' ? 'PERFECT'
      : quality === 'good' ? 'GOOD'
      : quality === 'early' ? 'EARLY'
      : quality === 'late' ? 'LATE'
      : 'OFF';
    setShown(label);
    const id = setTimeout(() => setShown(null), 380);
    return () => clearTimeout(id);
  }, [quality, totalTaps]);

  if (!shown) return null;
  return <div className={`vs__feedback vs__feedback--${shown.toLowerCase()}`}>{shown}</div>;
}

function Certificate({
  patient, lifeSeconds, bestCombo, outcome, score,
  certificate, morgueUrl, generating, certError, imageError,
  onRestart, onWall,
}: {
  patient: Patient;
  lifeSeconds: number;
  bestCombo: number;
  outcome: 'flatline' | 'vfib' | 'survived';
  score: number;
  certificate: DCert | null;
  morgueUrl: string | null;
  generating: boolean;
  certError: string | null;
  imageError: string | null;
  onRestart: () => void;
  onWall: () => void;
}) {
  const isSurvived = outcome === 'survived';
  const statusCause =
    outcome === 'vfib' ? 'V-fib' :
    outcome === 'flatline' ? 'asystole' :
    'released';

  // Build cert fields with fallbacks on API failure so we never stay
  // stuck at "drafting…"
  const fallbackCert: DCert = isSurvived
    ? {
        cause: 'admit dx: night-shift insomnia',
        time_of_death: '05:12 AM',
        last_words: 'tell whoever did that — thanks. weird hands.',
        verdict: 'discharge cleared. ride out the morning slowly.',
      }
    : {
        cause: 'the typewriter ribbon snapped',
        time_of_death: '03:47 AM',
        last_words: 'I told you the espresso was fine.',
        verdict: 'survived by their group chat.',
      };
  const finalCert = certificate ?? (certError && !generating ? fallbackCert : null);

  return (
    <div className={`vs vs--cert ${isSurvived ? 'is-survived' : ''}`}>
      <AmbientOverlay />
      <div className="vs-cert__head">{isSurvived ? t('cert.head_survived') : t('cert.head')}</div>
      <div className="vs-cert__portrait">
        <div className={`vs-cert__portraitFrame ${morgueUrl ? 'has-morgue' : ''} ${isSurvived ? 'is-survived' : ''}`}>
          {morgueUrl ? (
            <img src={morgueUrl} alt="" draggable={false} referrerPolicy="no-referrer" />
          ) : patient.head_url ? (
            <img src={patient.head_url} alt="" className="vs-cert__avatarFallback" draggable={false} referrerPolicy="no-referrer" />
          ) : (
            <div className="vs-cert__avatarPlaceholder">{(patient.name || '?').slice(0, 2).toUpperCase()}</div>
          )}
          {!morgueUrl && generating && <div className="vs-cert__developing">{t('cert.developing')}</div>}
          {!morgueUrl && !generating && imageError && (
            <div className="vs-cert__cameraOffline">{t('cert.camera_offline')}</div>
          )}
        </div>
      </div>
      <div className="vs-cert__namePlate">@{patient.name || patient.telegram_id}</div>

      <div className="vs-cert__row"><span>{t('cert.kept_alive')}</span><b>{lifeSeconds}s</b></div>
      <div className="vs-cert__row"><span>{t('cert.best_streak')}</span><b>×{bestCombo}</b></div>
      <div className="vs-cert__row"><span>{t('cert.score')}</span><b>{score.toString().padStart(5, '0')}</b></div>
      <div className="vs-cert__row"><span>{t('cert.type')}</span><b>{statusCause}</b></div>

      <div className="vs-cert__divider" />

      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{isSurvived ? t('cert.complaint') : t('cert.cause')}</div>
        <div className={`vs-cert__fieldValue ${!finalCert && generating ? 'is-loading' : ''}`}>
          {finalCert?.cause ?? (generating ? t('cert.drafting') : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{isSurvived ? t('cert.discharge_time') : t('cert.tod')}</div>
        <div className={`vs-cert__fieldValue ${!finalCert && generating ? 'is-loading' : ''}`}>
          {finalCert?.time_of_death ?? (generating ? '…' : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{isSurvived ? t('cert.on_waking') : t('cert.last_words')}</div>
        <div className={`vs-cert__fieldValue is-quote ${!finalCert && generating ? 'is-loading' : ''}`}>
          {finalCert?.last_words ? `"${finalCert.last_words}"` : (generating ? t('cert.listening') : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{isSurvived ? t('cert.discharge_verdict') : t('cert.verdict')}</div>
        <div className={`vs-cert__fieldValue is-italic ${!finalCert && generating ? 'is-loading' : ''}`}>
          {finalCert?.verdict ?? (generating ? t('cert.pondering') : '—')}
        </div>
      </div>

      <div className="vs-cert__actions">
        <button className="vs-cert__btn vs-cert__btn--ghost" onPointerDown={onWall}>
          {t('cert.btn_wall')}
        </button>
        <button className="vs-cert__btn" onPointerDown={onRestart}>
          {t('cert.btn_new')}
        </button>
      </div>
      <Watermark />
    </div>
  );
}

function Watermark() {
  return <img src="alteru.svg" className="vs__watermark" alt="AlterU" draggable={false} />;
}
