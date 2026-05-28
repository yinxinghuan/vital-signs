// Issues an AI death certificate after a flatline / V-fib event.
// Two parallel async calls:
//   - chat: returns JSON {cause, time_of_death, last_words, verdict}
//   - gen-image (img2img on patient avatar): cold-tone morgue portrait
//
// Both stream in independently. UI can render whichever lands first.

import { useCallback, useRef, useState } from 'react';
import { useChat, useGenImage } from '@shared/runtime';
import type { Patient } from '../types';

export interface DeathCertificate {
  cause: string;
  time_of_death: string;
  last_words: string;
  verdict: string;
}

export interface UseDeathCertificate {
  certificate: DeathCertificate | null;
  morgueUrl: string | null;
  generating: boolean;
  certError: string | null;
  imageError: string | null;
  generate: (input: {
    patient: Patient;
    lifeSeconds: number;
    cause: 'flatline' | 'vfib';
    bestCombo: number;
  }) => Promise<void>;
  reset: () => void;
}

const SYSTEM_PROMPT =
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

const MORGUE_PROMPT =
  `Cold morgue tag portrait of the same subject from the reference image. ` +
  `Closed eyes, pale composed expression, dignified. ` +
  `Fluorescent overhead light, blue-grey skin tone, white-tile background, ` +
  `soft top-down shadow, slight teal vignette. ` +
  `Faintly visible string-tag with crinkled card pinned at the shoulder. ` +
  `Editorial mood photograph, AlterU After Dark, no text in image, no captions.`;

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
  const { send: sendChat } = useChat({ system: SYSTEM_PROMPT, maxHistory: 0 });
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

  const generate = useCallback(async ({ patient, lifeSeconds, cause, bestCombo }: {
    patient: Patient;
    lifeSeconds: number;
    cause: 'flatline' | 'vfib';
    bestCombo: number;
  }) => {
    inFlightId.current += 1;
    const myId = inFlightId.current;
    setGenerating(true);
    setCertError(null);
    setImageError(null);
    setCertificate(null);
    setMorgueUrl(null);

    const causeWord = cause === 'vfib' ? 'V-fib / cardiac arrest' : 'asystole / flatline';

    const userPrompt =
      `Write a death certificate for the dream-ER record.\n` +
      `Patient kept alive: ${Math.floor(lifeSeconds)} seconds.\n` +
      `Best heartbeat streak: ${bestCombo}.\n` +
      `Final rhythm: ${causeWord}.\n` +
      `Return ONLY the JSON object as specified.`;

    const chatPromise = sendChat(userPrompt)
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
      ? callGenImage({ prompt: MORGUE_PROMPT, ref_url: patient.head_url })
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
