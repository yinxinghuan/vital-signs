// Community fate wall — last 6 patients across all players.

import { useState, useCallback } from 'react';
import { useGameEvent } from '@shared/runtime';
import { isSelf, type WallEntry } from '../hooks/useFateWall';
import { t } from '../i18n';

type ReactKind = 'candle' | 'salute' | 'rest';

interface Props {
  entries: WallEntry[];
  loaded: boolean;
  onBack: () => void;
}

export default function FateWall({ entries, loaded, onBack }: Props) {
  return (
    <div className="vs-wall">
      <div className="vs-wall__topbar">
        <button className="vs-wall__back" onPointerDown={onBack}>{t('wall.back')}</button>
        <div className="vs-wall__title">{t('wall.title')}</div>
        <div className="vs-wall__sub">{t('wall.sub')}</div>
      </div>

      <div className="vs-wall__list">
        {!loaded && (
          <>
            <div className="vs-wall__skeleton" />
            <div className="vs-wall__skeleton" />
            <div className="vs-wall__skeleton" />
          </>
        )}
        {loaded && entries.length === 0 && (
          <div className="vs-wall__empty">
            <div>{t('wall.empty1')}</div>
            <div className="vs-wall__emptyHint">{t('wall.empty2')}</div>
          </div>
        )}
        {entries.map((e) => (
          <FateCard key={`${e.byUserId}:${e.fate.id}`} entry={e} />
        ))}
      </div>
    </div>
  );
}

function fmtTimeAgo(ts: number): string {
  const ms = Date.now() - ts;
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function FateCard({ entry }: { entry: WallEntry }) {
  const f = entry.fate;
  const causeBadge = f.outcome === 'vfib' ? 'V-FIB' : f.outcome === 'survived' ? 'SURVIVED' : 'ASYSTOLE';
  const badgeClass = f.outcome === 'survived' ? 'is-survived' : 'is-lost';
  const mine = isSelf(entry);
  const event = useGameEvent();

  // Local optimistic reaction counts. Server may aggregate later; we only
  // ever increment, never decrement, per platform reactions contract.
  const initial = f.reactions ?? { candle: 0, salute: 0, rest: 0 };
  const [counts, setCounts] = useState<Record<ReactKind, number>>(initial);
  const [tapped, setTapped] = useState<Record<ReactKind, boolean>>({ candle: false, salute: false, rest: false });

  const react = useCallback((kind: ReactKind) => {
    if (tapped[kind]) return;
    setTapped((s) => ({ ...s, [kind]: true }));
    setCounts((s) => ({ ...s, [kind]: s[kind] + 1 }));
    event.trigger('fate_react', {
      target_user_id: entry.byUserId,
      fate_id: f.id,
      kind,
      outcome: f.outcome,
    });
  }, [tapped, event, entry.byUserId, f.id, f.outcome]);

  return (
    <div className={`vs-fate ${badgeClass} ${mine ? 'is-mine' : ''}`}>
      <div className="vs-fate__portrait">
        {f.morgueImageUrl ? (
          <img src={f.morgueImageUrl} alt="" draggable={false} referrerPolicy="no-referrer" />
        ) : f.patientAvatarUrl ? (
          <img src={f.patientAvatarUrl} alt="" className="vs-fate__avatarFallback" draggable={false} referrerPolicy="no-referrer" />
        ) : (
          <div className="vs-fate__placeholder">{(f.patientName || '?').slice(0, 2).toUpperCase()}</div>
        )}
        <div className={`vs-fate__badge ${badgeClass}`}>{causeBadge}</div>
      </div>
      <div className="vs-fate__body">
        <div className="vs-fate__nameRow">
          <span className="vs-fate__name">@{f.patientName || f.patientId}</span>
          <span className="vs-fate__life">{Math.floor(f.lifeSeconds)}s · ×{f.bestCombo}</span>
        </div>
        <div className="vs-fate__cause">{f.cause}</div>
        {f.lastWords && <div className="vs-fate__quote">&ldquo;{f.lastWords}&rdquo;</div>}
        {f.verdict && <div className="vs-fate__verdict">{f.verdict}</div>}
        <div className="vs-fate__footer">
          <span className="vs-fate__by">
            {mine && <span className="vs-fate__mine">YOU · </span>}
            attending: @{entry.byUserName || entry.byUserId.slice(0, 6)}
          </span>
          <span className="vs-fate__time">{fmtTimeAgo(f.createdAt)}</span>
        </div>
        <div className="vs-fate__reactRow">
          <ReactButton kind="candle" count={counts.candle} tapped={tapped.candle} onTap={react} />
          <ReactButton kind="salute" count={counts.salute} tapped={tapped.salute} onTap={react} />
          <ReactButton kind="rest" count={counts.rest} tapped={tapped.rest} onTap={react} />
        </div>
      </div>
    </div>
  );
}

function ReactButton({ kind, count, tapped, onTap }: { kind: ReactKind; count: number; tapped: boolean; onTap: (k: ReactKind) => void }) {
  return (
    <button
      className={`vs-react vs-react--${kind} ${tapped ? 'is-tapped' : ''}`}
      onPointerDown={(e) => { e.stopPropagation(); onTap(kind); }}
      disabled={tapped}
      aria-label={kind}
    >
      <ReactIcon kind={kind} />
      {count > 0 && <span className="vs-react__count">{count}</span>}
    </button>
  );
}

function ReactIcon({ kind }: { kind: ReactKind }) {
  if (kind === 'candle') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        <path d="M12 3 c -1.5 2 -2.5 3 -2.5 4.5 a 2.5 2.5 0 0 0 5 0 c 0 -1.5 -1 -2.5 -2.5 -4.5 z" fill="currentColor" opacity=".9" />
        <rect x="9.5" y="9" width="5" height="11" rx="0.6" fill="currentColor" opacity=".5" />
        <rect x="8.5" y="20" width="7" height="1.5" fill="currentColor" opacity=".6" />
      </svg>
    );
  }
  if (kind === 'salute') {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
        {/* simple salute: silhouette + raised hand */}
        <path d="M12 4 a 2.5 2.5 0 1 1 0 5 a 2.5 2.5 0 0 1 0 -5 z" fill="currentColor" opacity=".85" />
        <path d="M7 14 c 1 -3 3.5 -3.5 5 -3.5 s 4 .5 5 3.5 v 5 h -10 v -5 z" fill="currentColor" opacity=".6" />
        <path d="M14 6 l 3 -2.5 l -.5 3 z" fill="currentColor" opacity=".85" />
      </svg>
    );
  }
  // rest — a folded hands / horizontal cross
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
      <path d="M4 12 L20 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".8" />
      <path d="M12 8 L12 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity=".4" />
    </svg>
  );
}
