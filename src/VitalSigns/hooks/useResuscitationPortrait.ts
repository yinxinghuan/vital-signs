// Multi-variant resuscitation portraits.
// Generates 3 versions of the patient via img2img off their head_url:
//   - stable:   peaceful, calm teal light, oxygen mask gently on
//   - critical: distress visible, sweat, amber warning light, slight grimace
//   - lethal:   defibrillator pads on chest, harsh red emergency strobe
//
// All 3 fire in parallel at patient-pick time. Each variant cached per
// (telegram_id, variant). When you ask for a variant that's still
// generating or failed, the hook falls back to the next-lower tier so
// the monitor always shows SOMETHING (even if it's still the stable
// frame during a vfib event).

import { useEffect, useRef, useState } from 'react';
import { useGenImage } from '@shared/runtime';
import type { Patient } from '../types';

export type PortraitVariant = 'stable' | 'critical' | 'lethal';

const PROMPTS: Record<PortraitVariant, string> = {
  stable:
    `Close-up portrait of the same subject from the reference image, ` +
    `lying on an ER table during routine monitoring. ` +
    `Eyes closed peacefully, an oxygen mask sitting over the lower face, ` +
    `a thin IV tube taped to one arm at the edge of frame, ` +
    `EKG electrode stickers visible at the shoulder. ` +
    `Soft cool teal-blue overhead hospital lighting, gentle top-down shadows, ` +
    `composed dignified expression. Editorial mood photograph, shallow depth of field. ` +
    `AlterU After Dark cinematic atmosphere. No text. No captions. No labels.`,

  critical:
    `Close-up portrait of the same subject from the reference image, ` +
    `lying on an ER table during active intervention. ` +
    `Eyes closed but brow tensed, faint beads of sweat on forehead and temple, ` +
    `oxygen mask askew on the lower face, IV tube taped to one arm, ` +
    `EKG electrode stickers visible at the shoulder. ` +
    `Mixed amber and teal hospital lighting, harder shadows, slight redness ` +
    `creeping into one cheek. Editorial mood photograph, distressed but not gory. ` +
    `AlterU After Dark cinematic atmosphere. No text. No captions. No labels.`,

  lethal:
    `Close-up portrait of the same subject from the reference image, ` +
    `lying completely still on an ER table during cardiac arrest. ` +
    `Eyes closed, slack expression, oxygen mask covering nose and mouth, ` +
    `defibrillator paddle pads visible on the chest at the edge of frame, ` +
    `EKG electrode stickers, IV tube taped to one arm. ` +
    `Harsh red emergency overhead light bathing the scene, ` +
    `pallor in the skin, hard cool shadows. Editorial mood photograph, ` +
    `dignified, dramatic critical-care moment. AlterU After Dark. ` +
    `No text. No captions. No labels.`,
};

interface CacheEntry { url: string | null; promise: Promise<string> | null }
const cache = new Map<string, CacheEntry>();    // key = `${telegram_id}::${variant}`

export interface UseResuscitationPortraits {
  variants: Record<PortraitVariant, string | null>;
  loading: Record<PortraitVariant, boolean>;
  error: Record<PortraitVariant, string | null>;
}

const VARIANTS: PortraitVariant[] = ['stable', 'critical', 'lethal'];

export function useResuscitationPortraits(patient: Patient | null): UseResuscitationPortraits {
  const { generate } = useGenImage();
  const [variants, setVariants] = useState<Record<PortraitVariant, string | null>>({ stable: null, critical: null, lethal: null });
  const [loading, setLoading] = useState<Record<PortraitVariant, boolean>>({ stable: false, critical: false, lethal: false });
  const [error, setError] = useState<Record<PortraitVariant, string | null>>({ stable: null, critical: null, lethal: null });
  const reqRef = useRef<string | null>(null);

  useEffect(() => {
    if (!patient || !patient.head_url) {
      setVariants({ stable: null, critical: null, lethal: null });
      setLoading({ stable: false, critical: false, lethal: false });
      setError({ stable: null, critical: null, lethal: null });
      return;
    }
    const tid = patient.telegram_id;
    reqRef.current = tid;

    for (const v of VARIANTS) {
      const key = `${tid}::${v}`;
      const cached = cache.get(key);
      if (cached?.url) {
        setVariants((s) => ({ ...s, [v]: cached.url }));
        setLoading((s) => ({ ...s, [v]: false }));
        continue;
      }

      if (cached?.promise) {
        setLoading((s) => ({ ...s, [v]: true }));
        cached.promise
          .then((u) => { if (reqRef.current === tid) {
            setVariants((s) => ({ ...s, [v]: u }));
            setLoading((s) => ({ ...s, [v]: false }));
          }})
          .catch((e: unknown) => { if (reqRef.current === tid) {
            setError((s) => ({ ...s, [v]: e instanceof Error ? e.message : 'gen failed' }));
            setLoading((s) => ({ ...s, [v]: false }));
          }});
        continue;
      }

      // Fresh fire
      setLoading((s) => ({ ...s, [v]: true }));
      const promise = generate({ prompt: PROMPTS[v], ref_url: patient.head_url });
      cache.set(key, { url: null, promise });
      promise
        .then((u) => {
          cache.set(key, { url: u, promise: null });
          if (reqRef.current !== tid) return;
          setVariants((s) => ({ ...s, [v]: u }));
          setLoading((s) => ({ ...s, [v]: false }));
        })
        .catch((e: unknown) => {
          cache.delete(key);
          if (reqRef.current !== tid) return;
          setError((s) => ({ ...s, [v]: e instanceof Error ? e.message : 'gen failed' }));
          setLoading((s) => ({ ...s, [v]: false }));
        });
    }
  }, [patient, generate]);

  return { variants, loading, error };
}

/** Pick the best portrait available for a given state. Falls back gracefully:
 *  if `requested` isn't ready yet, return the next-lower tier that is. */
export function pickPortrait(
  variants: Record<PortraitVariant, string | null>,
  requested: PortraitVariant,
): string | null {
  if (requested === 'lethal') {
    return variants.lethal ?? variants.critical ?? variants.stable;
  }
  if (requested === 'critical') {
    return variants.critical ?? variants.stable;
  }
  return variants.stable;
}
