// Fetch the player's real Aigram contacts via the canonical platform
// bridge. Falls back to a small demo list only when running OUTSIDE
// Aigram (e.g. local `npm run preview`) — in production the bridge is
// always present and real friends load.
//
// (Adapted from wake-up-service/useAigramContacts — same pattern,
//  same rules: no demo padding for real users.)

import { useEffect, useState } from 'react';
import {
  callAigramAPI,
  isInAigram,
  telegramId,
  type AigramResponse,
} from '@shared/runtime';
import type { AigramContact } from '../types';

const MAX_CONTACTS = 12;

/** Local-preview placeholder only. Never reached when running in Aigram. */
const DEMO_CONTACTS: AigramContact[] = [
  { telegram_id: 'demo1', name: 'Algram',     head_url: '' },
  { telegram_id: 'demo2', name: 'Jenny',      head_url: '' },
  { telegram_id: 'demo3', name: 'JM·F',       head_url: '' },
  { telegram_id: 'demo4', name: 'ghostpixel', head_url: '' },
  { telegram_id: 'demo5', name: 'Isaya',      head_url: '' },
  { telegram_id: 'demo6', name: 'Isabel',     head_url: '' },
];

interface RawContact {
  telegram_id: number | string;
  name?: string;
  head_url?: string;
}

async function fetchUserName(tid: string): Promise<string | null> {
  try {
    const resp = await callAigramAPI<AigramResponse<{ name?: string }>>(
      `/note/telegram/user/get/info/by/telegram_id?telegram_id=${encodeURIComponent(tid)}`,
      'GET',
    );
    return resp?.data?.name || null;
  } catch {
    return null;
  }
}

async function fetchContacts(): Promise<AigramContact[]> {
  if (!telegramId) return [];

  const resp = await callAigramAPI<AigramResponse<RawContact[]>>(
    `/note/telegram/user/contact/list?telegram_id=${encodeURIComponent(telegramId)}`,
    'GET',
  );

  const rows: RawContact[] = Array.isArray(resp?.data) ? resp.data : [];
  const trimmed = rows.slice(0, MAX_CONTACTS).map((u) => ({
    telegram_id: String(u.telegram_id),
    name: u.name || '',
    head_url: u.head_url || '',
  }));
  if (trimmed.length === 0) return [];

  const enriched = await Promise.all(
    trimmed.map(async (c) => {
      if (c.name) return c;
      const name = await fetchUserName(c.telegram_id);
      return { ...c, name: name || c.telegram_id };
    }),
  );

  return enriched;
}

export interface UseAigramContactsResult {
  contacts: AigramContact[];
  loading: boolean;
  error: string | null;
  isDemo: boolean;
}

export function useAigramContacts(): UseAigramContactsResult {
  const [contacts, setContacts] = useState<AigramContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);

  useEffect(() => {
    if (!isInAigram) {
      setContacts(DEMO_CONTACTS);
      setIsDemo(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    fetchContacts()
      .then((result) => {
        if (cancelled) return;
        setContacts(result);
        setIsDemo(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'unknown');
        setContacts([]);
        setIsDemo(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { contacts, loading, error, isDemo };
}

/** Pick a random patient from the contact list. Returns null until loaded. */
export function pickRandomPatient(contacts: AigramContact[]): AigramContact | null {
  if (contacts.length === 0) return null;
  return contacts[Math.floor(Math.random() * contacts.length)];
}
