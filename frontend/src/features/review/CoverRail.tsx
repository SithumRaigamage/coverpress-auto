import { Image as ImageIcon } from 'lucide-react';
import { StatusChip } from '../../components/ui';
import { cn } from '../../lib/cn';
import type { Cover } from '../../api/types';

export function CoverRail({ covers, activeId, onSelect }: { covers: Cover[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <aside className="review-rail" aria-label="Covers in this shelf">
      <div className="review-rail__head">
        <strong>{covers.length} covers</strong>
        <span className="subtle mono">j / k to move</span>
      </div>
      <div className="review-rail__list">
        {covers.map((cover) => (
          <button
            type="button"
            key={cover.id}
            className={cn('rail-item', cover.id === activeId && 'rail-item--active')}
            aria-current={cover.id === activeId ? 'true' : undefined}
            onClick={() => onSelect(cover.id)}
          >
            <span className="rail-item__thumb">
              {cover.thumbUrl || cover.artUrl ? (
                <img src={cover.thumbUrl ?? cover.artUrl ?? ''} alt="" loading="lazy" />
              ) : (
                <ImageIcon size={16} strokeWidth={1.5} />
              )}
            </span>
            <span className="rail-item__text">
              <span className="rail-item__title">{cover.title}</span>
              <StatusChip status={cover.status} />
            </span>
            {cover.score !== null && <span className="mono rail-item__score">{cover.score}</span>}
          </button>
        ))}
      </div>
    </aside>
  );
}
