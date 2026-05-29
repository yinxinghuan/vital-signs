export type PatientStatus = 'alive' | 'critical' | 'flatline' | 'vfib';

export type TapQuality = 'perfect' | 'good' | 'off' | 'early' | 'late' | null;

export type EventKind =
  | 'steady'        // 60 BPM, baseline
  | 'drift_slow'    // BPM drifts down
  | 'drift_fast'    // BPM drifts up
  | 'tachy'         // sudden ↑↑
  | 'brady'         // sudden ↓↓
  | 'pvc';          // a single skipped beat (insert a pause)

export interface VitalsEvent {
  kind: EventKind;
  startAt: number;
  endAt: number;
  fromBPM: number;
  toBPM: number;
}

// Matches the Aigram contact shape from /note/telegram/user/contact/list.
export interface AigramContact {
  telegram_id: string;
  name: string;
  head_url: string;
}

// Aigram contact promoted to "patient" for the rhythm game.
export type Patient = AigramContact;

export interface FateRecord {
  id: string;            // local UUID; included so we can de-dup
  patientId: string;     // telegram_id (string)
  patientName: string;
  patientAvatarUrl: string;
  outcome: 'flatline' | 'vfib' | 'survived';
  lifeSeconds: number;
  bestCombo: number;
  score: number;
  cause: string;         // AI-generated
  lastWords: string;     // AI-generated
  timeOfDeath: string;
  verdict: string;
  morgueImageUrl: string | null;
  /** AI resuscitation portraits gen'd during play. Persisted so we don't
   *  re-spend tokens on rewatch + so the Fate Wall has a richer visual. */
  erPortraits?: {
    stable: string | null;
    critical: string | null;
    lethal: string | null;
  };
  createdAt: number;
  reactions?: { candle: number; salute: number; rest: number };
}

export interface VitalSignsSave {
  history: FateRecord[]; // most-recent first; capped to last ~24
  totalShifts: number;
  totalSeconds: number;
}
