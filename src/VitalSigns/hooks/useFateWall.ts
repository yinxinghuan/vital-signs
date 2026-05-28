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
        const parsed: { row: SaveRow; fate: FateRecord }[] = [];
        for (const row of rows) {
          if (!row.user_id || !row.resource_data) continue;
          try {
            const save = JSON.parse(row.resource_data) as VitalSignsSave;
            const fate = save.history?.[0];
            if (fate) parsed.push({ row, fate });
          } catch { /* skip corrupt */ }
          if (parsed.length >= 6) break;
        }
        const profiles = await Promise.all(
          parsed.map(({ row }) =>
            callAigramAPI<AigramResponse<{ name?: string; head_url?: string }>>(
              `/note/telegram/user/get/info/by/telegram_id?telegram_id=${encodeURIComponent(row.user_id)}`,
              'GET',
            ).catch(() => null),
          ),
        );
        if (cancelled) return;
        setEntries(parsed.map(({ row, fate }, i) => ({
          byUserId: row.user_id,
          byUserName: profiles[i]?.data?.name,
          byUserAvatarUrl: profiles[i]?.data?.head_url,
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
