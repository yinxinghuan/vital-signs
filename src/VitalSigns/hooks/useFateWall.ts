// Fetch the 6 most-recent users and pull each one's latest fate.
//
// Wire: get/data/list?session_id=<gameUUID> returns up to 6 rows. Each row's
// `resource_data` parses as VitalSignsSave; we pull `history[0]` as that
// user's most-recent fate. User name + avatar resolved in parallel as a
// fallback when the stored patient info is thin.

import { useCallback, useEffect, useState } from 'react';
import {
  callAigramAPI,
  isInAigram,
  telegramId,
  type AigramResponse,
} from '@shared/runtime/bridge';
import { getGameUuid } from '@shared/runtime/game-id';
import type { FateRecord, VitalSignsSave } from '../types';

interface SaveRow {
  user_id: string;
  time?: string;
  resource_data?: string;
}

export interface WallEntry {
  byUserId: string;
  byUserName?: string;
  byUserAvatarUrl?: string;
  fate: FateRecord;
}

export interface UseFateWall {
  entries: WallEntry[];
  loaded: boolean;
  refresh: () => void;
}

export function useFateWall(): UseFateWall {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    const sessionId = getGameUuid();
    if (!isInAigram || !sessionId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await callAigramAPI<AigramResponse<SaveRow[]>>(
          `/note/aigram/ai/game/get/data/list?session_id=${encodeURIComponent(sessionId)}`,
          'GET',
        );
        const rows = Array.isArray(res?.data) ? res.data : [];

        // ── Flatten across users instead of only-most-recent per user ──
        // Old behavior took history[0] per row = 1 fate per user; new game
        // overwrote the previous on the public wall. Now we walk every
        // stored history slot so older fates stick around alongside newer
        // ones, then sort by createdAt desc and cap at 24.
        const HISTORY_PER_USER = 6;
        const TOTAL_CAP = 24;

        const flat: { userId: string; fate: FateRecord }[] = [];
        const userOrder: string[] = [];   // dedup ordering of users for profile fetch
        for (const row of rows) {
          if (!row.user_id || !row.resource_data) continue;
          try {
            const save = JSON.parse(row.resource_data) as VitalSignsSave;
            const fates = (save.history ?? []).slice(0, HISTORY_PER_USER);
            for (const fate of fates) {
              if (!fate) continue;
              flat.push({ userId: row.user_id, fate });
            }
            if (!userOrder.includes(row.user_id)) userOrder.push(row.user_id);
          } catch { /* skip corrupt */ }
        }

        flat.sort((a, b) => (b.fate.createdAt ?? 0) - (a.fate.createdAt ?? 0));
        const capped = flat.slice(0, TOTAL_CAP);

        // Profile lookup once per unique user
        const uniqUsers = Array.from(new Set(capped.map((x) => x.userId)));
        const profiles = await Promise.all(
          uniqUsers.map((uid) =>
            callAigramAPI<AigramResponse<{ name?: string; head_url?: string }>>(
              `/note/telegram/user/get/info/by/telegram_id?telegram_id=${encodeURIComponent(uid)}`,
              'GET',
            ).catch(() => null),
          ),
        );
        const profByUser = new Map<string, { name?: string; head_url?: string } | undefined>();
        uniqUsers.forEach((uid, i) => profByUser.set(uid, profiles[i]?.data));

        if (cancelled) return;
        // referencing userOrder so it doesn't unused-warn; legacy field kept
        void userOrder;
        setEntries(capped.map(({ userId, fate }) => ({
          byUserId: userId,
          byUserName: profByUser.get(userId)?.name,
          byUserAvatarUrl: profByUser.get(userId)?.head_url,
          fate,
        })));
      } catch {
        if (!cancelled) setEntries([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [nonce]);

  return { entries, loaded, refresh };
}

export function isSelf(entry: WallEntry): boolean {
  return !!telegramId && entry.byUserId === String(telegramId);
}
