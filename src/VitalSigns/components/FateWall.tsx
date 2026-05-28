// Community fate wall — last 6 patients across all players.

import type { WallEntry } from '../hooks/useFateWall';
import { t } from '../i18n';

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

  return (
    <div className={`vs-fate ${badgeClass}`}>
      <div className="vs-fate__portrait">
        {f.morgueImageUrl ? (
          <img src={f.morgueImageUrl} alt="" draggable={false} />
        ) : f.patientAvatarUrl ? (
          <img src={f.patientAvatarUrl} alt="" className="vs-fate__avatarFallback" draggable={false} />
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
          <span className="vs-fate__by">attending: @{entry.byUserName || entry.byUserId.slice(0, 6)}</span>
          <span className="vs-fate__time">{fmtTimeAgo(f.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
