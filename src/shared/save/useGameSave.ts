// Per-user game save sync. Reads/writes through the Aigram platform's
// session-scoped save endpoints. Same public API as before — `gameId`
// argument retained for localStorage key namespacing; cloud scoping is now
// the per-game UUID (`session_id`) from @shared/runtime/game-id.
//
// Wire shape note: the platform's get/data/list returns the **6 most recent
// users' latest** saves for this session. To support the legacy
// "load my own save" contract, we filter the list to the current
// telegram_id. Other entries are discarded by this hook (a future hook
// could expose them for social features).

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  callAigramAPI,
  postAigramAPI,
  isInAigram,
  telegramId,
  type AigramResponse,
} from '../runtime/bridge';
import { getGameUuid } from '../runtime/game-id';

interface SaveRow {
  user_id: string;
  time: string;
  resource_data: string;
}

export interface UseGameSave<T> {
  /** Initial save loaded from cloud / localStorage. `undefined` while loading, `null` if no save exists. */
  savedData: T | null | undefined;
  /** True once the initial probe completed (regardless of whether a save was found). */
  loaded: boolean;
  /** Convenience: true when a save exists. */
  hasSave: boolean;
  /** Persist save data. Synchronously to localStorage; cloud write debounced (1s) and fire-and-forget. */
  persist: (data: T) => void;
  /** Erase save from cloud + localStorage. */
  clear: () => Promise<void>;
}

/**
 * Per-user save sync. `gameId` only namespaces the localStorage key — cloud
 * scoping is always the game's permanent UUID, set via @shared/runtime/
 * setGameUuid at boot.
 */
export function useGameSave<T>(gameId: string): UseGameSave<T> {
  const [savedData, setSavedData] = useState<T | null | undefined>(undefined);
  const lsKey = `${gameId}-save`;
  const sessionId = getGameUuid();
  const canSync = isInAigram && !!sessionId && !!telegramId;
  const cloudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataRef = useRef<T | null>(null);

  // Initial load: cloud → localStorage → null
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (canSync && sessionId && telegramId) {
        try {
          const res = await callAigramAPI<AigramResponse<SaveRow[]>>(
            `/note/aigram/ai/game/get/data/list?session_id=${encodeURIComponent(sessionId)}`,
            'GET',
          );
          const rows: SaveRow[] = Array.isArray(res?.data) ? res.data : [];
          const mine = rows.find(r => r.user_id === telegramId);
          if (mine && mine.resource_data) {
            try {
              const save = JSON.parse(mine.resource_data) as T;
              if (!cancelled) setSavedData(save);
              return;
            } catch {
              /* corrupt cloud save — fall through to local */
            }
          }
        } catch {
          /* network / bridge — fall through */
        }
      }
      try {
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const save = JSON.parse(raw) as T;
          if (!cancelled) setSavedData(save);
          return;
        }
      } catch {
        /* corrupt local — fall through */
      }
      if (!cancelled) setSavedData(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [canSync, sessionId, lsKey]);

  const flushCloud = useCallback(() => {
    const payload = pendingDataRef.current;
    pendingDataRef.current = null;
    cloudTimerRef.current = null;
    if (payload == null || !canSync || !sessionId) return;
    postAigramAPI('/note/aigram/ai/game/save/data', {
      session_id: sessionId,
      resource_data: JSON.stringify(payload),
    });
  }, [canSync, sessionId]);

  const persist = useCallback(
    (data: T) => {
      const withTs = { ...(data as object), _lastActive: Date.now() } as T;
      try {
        localStorage.setItem(lsKey, JSON.stringify(withTs));
      } catch {
        /* quota / private mode */
      }
      if (canSync) {
        pendingDataRef.current = withTs;
        if (cloudTimerRef.current) clearTimeout(cloudTimerRef.current);
        cloudTimerRef.current = setTimeout(flushCloud, 1000);
      }
    },
    [canSync, lsKey, flushCloud],
  );

  // Flush any pending write on unmount so we don't lose the latest save.
  useEffect(() => {
    return () => {
      if (cloudTimerRef.current) {
        clearTimeout(cloudTimerRef.current);
        flushCloud();
      }
    };
  }, [flushCloud]);

  const clear = useCallback(async () => {
    if (cloudTimerRef.current) {
      clearTimeout(cloudTimerRef.current);
      cloudTimerRef.current = null;
    }
    pendingDataRef.current = null;
    try {
      localStorage.removeItem(lsKey);
    } catch {
      /* ignore */
    }
    if (canSync && sessionId) {
      // No DELETE in the new API — write an empty payload. Consumers should
      // treat an empty resource_data as no-save (see the load path above).
      postAigramAPI('/note/aigram/ai/game/save/data', {
        session_id: sessionId,
        resource_data: '',
      });
    }
    setSavedData(null);
  }, [canSync, sessionId, lsKey]);

  return {
    savedData,
    loaded: savedData !== undefined,
    hasSave: savedData != null,
    persist,
    clear,
  };
}
