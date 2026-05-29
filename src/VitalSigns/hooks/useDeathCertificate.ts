// Issues an AI death certificate after a flatline / V-fib event.
// Two parallel async calls:
//   - chat: returns JSON {cause, time_of_death, last_words, verdict}
//   - gen-image (img2img on patient avatar): cold-tone morgue portrait
//
// Both stream in independently. UI can render whichever lands first.

import { useCallback, useRef, useState } from 'react';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { useChat, useGenImage } from '@shared/runtime';
import type { Patient } from '../types';

export interface DeathCertificate {
  cause: string;
  time_of_death: string;
  last_words: string;
  verdict: string;
}

export type Outcome = 'flatline' | 'vfib' | 'survived';

export interface UseDeathCertificate {
  certificate: DeathCertificate | null;
  morgueUrl: string | null;
  generating: boolean;
  certError: string | null;
  imageError: string | null;
  generate: (input: {
    patient: Patient;
    lifeSeconds: number;
    outcome: Outcome;
    bestCombo: number;
  }) => Promise<void>;
  reset: () => void;
}

const DEATH_SYSTEM_PROMPT =
  `You are an exhausted ER night-shift attending writing a death certificate ` +
  `as a deadpan, slightly bitter AlterU After Dark monologue. Treat this as ` +
  `fiction inside the player's dream — the patient is not really dead. ` +
  `Black humor, never cruel about the person, ` +
  `never mention specific identifying details about them. ` +
  `Reply with ONLY valid JSON, no markdown, no commentary, no code fences. ` +
  `Schema: {"cause": string, "time_of_death": string, "last_words": string, "verdict": string}. ` +
  `Constraints: cause ≤ 60 chars, vaguely medical-ish (e.g. "rhythm-induced bradycardia at 3:47 AM", ` +
  `"sympathetic overdrive · self-induced tachycardia"). ` +
  `time_of_death is "hh:mm AM/PM" (always after midnight, before 5 AM). ` +
  `last_words ≤ 90 chars, in the patient's first person, mundane or funny ` +
  `(e.g. "I told you the espresso was fine."). ` +
  `verdict ≤ 100 chars, one-line dry ruling from the attending ` +
  `(e.g. "Survived by their group chat. Patient ID retired with honors.").`;

const DISCHARGE_SYSTEM_PROMPT =
  `You are an exhausted ER night-shift attending writing a DISCHARGE NOTE ` +
  `for a patient who pulled through the night — AlterU After Dark, deadpan, ` +
  `quietly fond, a little ribbing. Treat as fiction inside the player's dream. ` +
  `Reply with ONLY valid JSON, no markdown. ` +
  `Schema: {"cause": string, "time_of_death": string, "last_words": string, "verdict": string}. ` +
  `Reuse the same field names but reinterpret them as discharge fields: ` +
  `cause ≤ 60 chars = the "presenting complaint" they came in with, vaguely funny ` +
  `(e.g. "narrative-induced tachycardia · 03:11", "acute imposter syndrome"). ` +
  `time_of_death is "hh:mm AM/PM" — re-frame as discharge time, between 4 AM and 6 AM. ` +
  `last_words ≤ 90 chars, in the patient's first person ON WAKING ` +
  `(e.g. "Did I make it? I dreamed someone was tapping on my chest."). ` +
  `verdict ≤ 100 chars, the attending's one-line release ruling ` +
  `(e.g. "Cleared to vibe. Recommend two days of yogurt and silence.").`;

const MORGUE_PROMPT =
  `Cold morgue tag portrait of the same subject from the reference image. ` +
  `Closed eyes, pale composed expression, dignified. ` +
  `Fluorescent overhead light, blue-grey skin tone, white-tile background, ` +
  `soft top-down shadow, slight teal vignette. ` +
  `Faintly visible string-tag with crinkled card pinned at the shoulder. ` +
  `Editorial mood photograph, AlterU After Dark, no text in image, no captions.`;

const DISCHARGE_PROMPT =
  `Soft hospital recovery portrait of the same subject from the reference image. ` +
  `Eyes barely open, calm composed expression, color returning to their face. ` +
  `Warm dawn light from a hospital window slatted through blinds, off-white sheets, ` +
  `IV taken out, small bandage at the wrist visible. ` +
  `Editorial mood photograph, gentle warmth, AlterU After Dark soft-tone variant, ` +
  `no text in image, no captions.`;

// Retry pattern: long-running fetches (~30-200s for gen-image, ~10-30s for
// chat) routinely die when iOS / Telegram WebView suspends background tabs
// during scroll. Without retry the cert/morgue slot stays empty for the
// rest of the session. Schedule: 5s → 15s → 45s.
const RETRY_DELAYS_MS = [2000, 8000, 25000];

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: Error = new Error('no attempts');
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      // eslint-disable-next-line no-console
      console.warn(`[cert/${label}] attempt ${attempt + 1} failed:`, lastErr.message);
      if (attempt >= RETRY_DELAYS_MS.length) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

function extractJson(raw: string): DeathCertificate | null {
  // Strip potential code fences and find the outermost JSON object
  const trimmed = raw.replace(/```(?:json)?/gi, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(trimmed.slice(start, end + 1));
    if (
      typeof obj?.cause === 'string' &&
      typeof obj?.time_of_death === 'string' &&
      typeof obj?.last_words === 'string' &&
      typeof obj?.verdict === 'string'
    ) {
      return obj as DeathCertificate;
    }
  } catch {
    return null;
  }
  return null;
}

export function useDeathCertificate(): UseDeathCertificate {
  // We swap the system prompt per call by constructing a fresh useChat
  // instance for death vs discharge. Since useChat caches the system in
  // closure, we instead pass system inside `send` via re-init — but for
  // simplicity we keep a single useChat with no system, and prepend the
  // chosen system as a user-flavor instruction in the prompt itself.
  const { send: sendChat } = useChat({ maxHistory: 0 });
  const { generate: callGenImage } = useGenImage();

  const [certificate, setCertificate] = useState<DeathCertificate | null>(null);
  const [morgueUrl, setMorgueUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [certError, setCertError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const inFlightId = useRef(0);

  const reset = useCallback(() => {
    setCertificate(null);
    setMorgueUrl(null);
    setCertError(null);
    setImageError(null);
    setGenerating(false);
    inFlightId.current += 1;
  }, []);

  const generate = useCallback(async ({ patient, lifeSeconds, outcome, bestCombo }: {
    patient: Patient;
    lifeSeconds: number;
    outcome: Outcome;
    bestCombo: number;
  }) => {
    inFlightId.current += 1;
    const myId = inFlightId.current;
    setGenerating(true);
    setCertError(null);
    setImageError(null);
    setCertificate(null);
    setMorgueUrl(null);

    const isSurvived = outcome === 'survived';
    const causeWord =
      outcome === 'vfib' ? 'V-fib / cardiac arrest' :
      outcome === 'flatline' ? 'asystole / flatline' :
      'discharge after sustained pulse capture';

    const systemPrompt = isSurvived ? DISCHARGE_SYSTEM_PROMPT : DEATH_SYSTEM_PROMPT;
    const imagePrompt = isSurvived ? DISCHARGE_PROMPT : MORGUE_PROMPT;

    const userPrompt =
      `${systemPrompt}\n\n` +
      `${isSurvived ? 'Write a discharge note' : 'Write a death certificate'} for the dream-ER record.\n` +
      `Patient kept alive: ${Math.floor(lifeSeconds)} seconds.\n` +
      `Best heartbeat streak: ${bestCombo}.\n` +
      `Final rhythm: ${causeWord}.\n` +
      `Return ONLY the JSON object as specified.`;

    const chatPromise = withRetry('chat', () => sendChat(userPrompt))
      .then((raw) => {
        if (inFlightId.current !== myId) return;
        const parsed = extractJson(raw);
        if (!parsed) {
          setCertError('parse');
          return;
        }
        setCertificate(parsed);
      })
      .catch((e: unknown) => {
        if (inFlightId.current !== myId) return;
        setCertError(e instanceof Error ? e.message : 'chat failed');
      });

    const imgPromise = patient.head_url
      ? withRetry('morgue', () => callGenImage({ prompt: imagePrompt, ref_url: patient.head_url }))
          .then((url) => {
            if (inFlightId.current !== myId) return;
            setMorgueUrl(url);
          })
          .catch((e: unknown) => {
            if (inFlightId.current !== myId) return;
            setImageError(e instanceof Error ? e.message : 'gen-image failed');
          })
      : Promise.resolve();

    await Promise.allSettled([chatPromise, imgPromise]);
    if (inFlightId.current === myId) setGenerating(false);
  }, [sendChat, callGenImage]);

  return { certificate, morgueUrl, generating, certError, imageError, generate, reset };
}
