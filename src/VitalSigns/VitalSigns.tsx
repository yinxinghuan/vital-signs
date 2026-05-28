// VitalSigns — top-level component. Owns the phase machine + wires the
// rhythm engine, ECG render, HUD, Aigram patient picker. (LLM + wall
// come in later tasks.)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './VitalSigns.less';
import { useHeartbeat } from './hooks/useHeartbeat';
import { useAigramContacts, pickRandomPatient } from './hooks/useAigramContacts';
import { useDeathCertificate, type DeathCertificate as DCert } from './hooks/useDeathCertificate';
import { useFateWall } from './hooks/useFateWall';
import { useGameSave } from '@shared/save';
import type { Patient, FateRecord, VitalSignsSave } from './types';
import EcgCanvas from './components/EcgCanvas';
import Hud from './components/Hud';
import FateWall from './components/FateWall';
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
        cause,
        bestCombo: cur.state.bestCombo,
      });
    }

    setTimeout(() => {
      audio.stopSustained();
      setPhase('certificate');
    }, 2600);
  }, [cert, patient]);

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
      outcome: state.status === 'vfib' ? 'vfib' : 'flatline',
      lifeSeconds: Math.floor(state.lifeSeconds),
      bestCombo: state.bestCombo,
      score: state.score,
      cause: cert.certificate.cause,
      lastWords: cert.certificate.last_words,
      timeOfDeath: cert.certificate.time_of_death,
      verdict: cert.certificate.verdict,
      morgueImageUrl: cert.morgueUrl,
      createdAt: Date.now(),
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

  const onTapZone = useCallback(() => {
    if (phase === 'playing') tap();
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
        <PatientCard patient={patient} />
        <div className="vs-splash__instructions">
          <div className="vs-splash__line">{t('splash.line1')}</div>
          <div className="vs-splash__line">{t('splash.line2')}</div>
        </div>
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
        <PatientCard patient={patient} dying />
        <div className="vs-dying__msg">
          {state.status === 'vfib' ? t('die.vfib') : t('die.flatline')}
        </div>
        <Watermark />
      </div>
    );
  }

  if (phase === 'certificate') {
    return (
      <Certificate
        patient={patient}
        lifeSeconds={Math.floor(state.lifeSeconds)}
        bestCombo={state.bestCombo}
        statusCause={state.status === 'vfib' ? 'V-fib' : 'asystole'}
        score={state.score}
        certificate={cert.certificate}
        morgueUrl={cert.morgueUrl}
        generating={cert.generating}
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

  return (
    <div className="vs vs--play" onPointerDown={onTapZone}>
      <PatientCard patient={patient} state={state.status} />
      <Hud state={state} patientName={patient.name || patient.telegram_id} />
      <div className="vs__ecg">
        <EcgCanvas beats={beats} status={state.status} />
      </div>
      <div className="vs__tapZone">
        <TargetRing targetBPM={state.targetBPM} status={state.status} />
        <div className="vs__tapHint">
          {state.totalTaps < 3 ? t('play.hint') : ''}
        </div>
        <TapFeedback quality={state.lastQuality} totalTaps={state.totalTaps} />
      </div>
      <Watermark />
    </div>
  );
}

function PatientCard({ patient, state, dying }: { patient: Patient; state?: string; dying?: boolean }) {
  const initials = useMemo(() => (patient.name || patient.telegram_id || '?').slice(0, 2).toUpperCase(), [patient]);
  return (
    <div className={`vs-patient ${dying ? 'is-dying' : ''} ${state === 'critical' ? 'is-critical' : ''}`}>
      <div className="vs-patient__frame">
        {patient.head_url ? (
          <img src={patient.head_url} alt="" draggable={false} />
        ) : (
          <div className="vs-patient__placeholder">{initials}</div>
        )}
        <div className="vs-patient__scan" />
      </div>
      <div className="vs-patient__name">@{patient.name || patient.telegram_id}</div>
    </div>
  );
}

function TargetRing({ targetBPM, status }: { targetBPM: number; status: string }) {
  // CSS pulse cue synchronized to the patient's current target BPM.
  // animation-duration is set inline so it re-syncs when BPM drifts.
  const durationMs = 60000 / Math.max(20, targetBPM);
  const isLethal = status === 'flatline' || status === 'vfib';
  return (
    <div
      className={`vs-target ${isLethal ? 'is-lethal' : ''}`}
      style={{ animationDuration: `${durationMs}ms` }}
      // Re-key forces the animation to reset whenever BPM crosses 5-bpm bucket.
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
  patient, lifeSeconds, bestCombo, statusCause, score,
  certificate, morgueUrl, generating, onRestart, onWall,
}: {
  patient: Patient;
  lifeSeconds: number;
  bestCombo: number;
  statusCause: string;
  score: number;
  certificate: DCert | null;
  morgueUrl: string | null;
  generating: boolean;
  onRestart: () => void;
  onWall: () => void;
}) {
  return (
    <div className="vs vs--cert">
      <div className="vs-cert__head">{t('cert.head')}</div>
      <div className="vs-cert__portrait">
        <div className={`vs-cert__portraitFrame ${morgueUrl ? 'has-morgue' : ''}`}>
          {morgueUrl ? (
            <img src={morgueUrl} alt="morgue tag" draggable={false} />
          ) : patient.head_url ? (
            <img src={patient.head_url} alt="" className="vs-cert__avatarFallback" draggable={false} />
          ) : (
            <div className="vs-cert__avatarPlaceholder">{(patient.name || '?').slice(0, 2).toUpperCase()}</div>
          )}
          {!morgueUrl && generating && <div className="vs-cert__developing">{t('cert.developing')}</div>}
        </div>
      </div>
      <div className="vs-cert__namePlate">@{patient.name || patient.telegram_id}</div>

      <div className="vs-cert__row"><span>{t('cert.kept_alive')}</span><b>{lifeSeconds}s</b></div>
      <div className="vs-cert__row"><span>{t('cert.best_streak')}</span><b>×{bestCombo}</b></div>
      <div className="vs-cert__row"><span>{t('cert.score')}</span><b>{score.toString().padStart(5, '0')}</b></div>
      <div className="vs-cert__row"><span>{t('cert.type')}</span><b>{statusCause}</b></div>

      <div className="vs-cert__divider" />

      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{t('cert.cause')}</div>
        <div className={`vs-cert__fieldValue ${!certificate && generating ? 'is-loading' : ''}`}>
          {certificate?.cause ?? (generating ? t('cert.drafting') : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{t('cert.tod')}</div>
        <div className={`vs-cert__fieldValue ${!certificate && generating ? 'is-loading' : ''}`}>
          {certificate?.time_of_death ?? (generating ? '…' : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{t('cert.last_words')}</div>
        <div className={`vs-cert__fieldValue is-quote ${!certificate && generating ? 'is-loading' : ''}`}>
          {certificate?.last_words ? `"${certificate.last_words}"` : (generating ? t('cert.listening') : '—')}
        </div>
      </div>
      <div className="vs-cert__field">
        <div className="vs-cert__fieldLabel">{t('cert.verdict')}</div>
        <div className={`vs-cert__fieldValue is-italic ${!certificate && generating ? 'is-loading' : ''}`}>
          {certificate?.verdict ?? (generating ? t('cert.pondering') : '—')}
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
