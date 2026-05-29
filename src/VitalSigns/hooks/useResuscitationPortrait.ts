// Pre-generate an "on the table mid-resuscitation" portrait for the current
// patient via img2img on their head_url. We fire as soon as the patient is
// chosen (during splash) so it's usually ready by the time the player gets
// to the playing phase; if it lands later, the patient frame cross-fades
// from raw avatar to ER portrait.
//
// Cached per telegram_id — re-selecting the same patient in a session reuses
// the same URL instead of paying another 30-200s gen.

import { useEffect, useRef, useState } from 'react';
import { useGenImage } from '@shared/runtime';
import type { Patient } from '../types';

const PROMPT =
  `Close-up portrait of the same subject from the reference image, ` +
  `lying on an ER table during emergency resuscitation. ` +
  `Eyes closed peacefully, an oxygen mask sitting over the lower face, ` +
  `a thin IV tube taped to one arm at the edge of frame, ` +
  `EKG electrode stickers visible at the shoulder. ` +
  `Dim teal-blue overhead hospital lighting carving hard top-down shadows, ` +
  `subtle pallor to the skin, dignified composed expression. ` +
  `Editorial mood photograph, shallow depth of field, AlterU After Dark ` +
  `cinematic atmosphere. No text in image. No captions. No labels.`;

interface CacheEntry { url: string | null; promise: Promise<string> | null; }
const cache = new Map<string, CacheEntry>();

export interface UseResuscitationPortrait {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useResuscitationPortrait(patient: Patient | null): UseResuscitationPortrait {
  const { generate } = useGenImage();
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef<string | null>(null);

  useEffect(() => {
    if (!patient || !patient.head_url) {
      setUrl(null);
      setLoading(false);
      setError(null);
      return;
    }
    const key = patient.telegram_id;
    reqRef.current = key;

    // Cache hit (already resolved) — instantly reuse
    const cached = cache.get(key);
    if (cached?.url) {
      setUrl(cached.url);
      setLoading(false);
      setError(null);
      return;
    }
    // Cache hit (in flight) — await the same promise
    if (cached?.promise) {
      setLoading(true);
      setError(null);
      cached.promise
        .then((u) => {
          if (reqRef.current !== key) return;
          setUrl(u);
          setLoading(false);
        })
        .catch((e: unknown) => {
          if (reqRef.current !== key) return;
          setError(e instanceof Error ? e.message : 'gen failed');
          setLoading(false);
        });
      return;
    }

    // Fire a fresh generation
    setLoading(true);
    setError(null);
    setUrl(null);

    const promise = generate({ prompt: PROMPT, ref_url: patient.head_url });
    cache.set(key, { url: null, promise });

    promise
      .then((u) => {
        cache.set(key, { url: u, promise: null });
        if (reqRef.current !== key) return;
        setUrl(u);
        setLoading(false);
      })
      .catch((e: unknown) => {
        cache.delete(key);
        if (reqRef.current !== key) return;
        setError(e instanceof Error ? e.message : 'gen failed');
        setLoading(false);
      });
  }, [patient, generate]);

  return { url, loading, error };
}
