import { Layers3 } from 'lucide-react';
import { EmptyState } from '../../components/ui';
import type { Cover } from '../../api/types';
import { CoverCard } from './CoverCard';

export function CoverGrid({ covers, projectId, busy }: { covers: Cover[]; projectId: string; busy: boolean }) {
  if (covers.length === 0) {
    return (
      <EmptyState
        icon={<Layers3 size={22} />}
        title="No covers yet"
        body="Add a list of titles above. Auto titles fetch metadata; manual titles wait for your art."
      />
    );
  }

  return (
    <div className="cover-grid">
      {covers.map((cover) => (
        <CoverCard key={cover.id} cover={cover} projectId={projectId} busy={busy} />
      ))}
    </div>
  );
}
