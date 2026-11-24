import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { Printer, RefreshCw, Sparkles } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useBuildProject } from '../../api/mutations';
import { useInvalidateOnIdle, useProject } from '../../api/queries';
import { Button, Chip, ErrorPanel, Skeleton, SkeletonCards } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { mergeStatuses } from '../../lib/format';
import { CoverGrid } from '../covers/CoverGrid';
import { HouseStylePanel } from '../covers/HouseStylePanel';
import { ImportPanel } from '../covers/ImportPanel';

export function Shelf() {
  const { id = '' } = useParams();
  const projectQuery = useProject(id);
  const statusQuery = useInvalidateOnIdle(id);
  const buildAll = useBuildProject(id);
  const { toast } = useToast();

  const project = projectQuery.data?.project;
  const pending = statusQuery.data?.pending ?? projectQuery.data?.pending ?? 0;
  const covers = useMemo(
    () => mergeStatuses(projectQuery.data?.covers ?? [], statusQuery.data?.covers ?? []),
    [projectQuery.data?.covers, statusQuery.data?.covers],
  );
  const reviewable = covers.filter((cover) => cover.status === 'needs_review').length;
  const ready = covers.filter((cover) => cover.status === 'approved' || cover.status === 'auto_approved').length;

  if (projectQuery.isPending) {
    return (
      <div className="screen">
        <Skeleton className="skeleton--title" />
        <SkeletonCards count={6} />
      </div>
    );
  }
  if (projectQuery.isError || !project) {
    return (
      <div className="screen">
        <ErrorPanel message={errorMessage(projectQuery.error)} onRetry={() => void projectQuery.refetch()} />
        <p className="subtle" style={{ marginTop: 12 }}><Link to="/">← Back to shelves</Link></p>
      </div>
    );
  }

  return (
    <div className="screen">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Shelves</Link> / <span>{project.name}</span>
      </nav>

      <header className="screen-header">
        <div>
          <p className="eyebrow">Shelf</p>
          <h1>{project.name}</h1>
          <div className="chip-row">
            <Chip tone="accent">{project.platform}</Chip>
            <Chip>{covers.length} covers</Chip>
            <Chip tone="ok">{ready} ready</Chip>
            <Chip tone="warn">{reviewable} to review</Chip>
            {pending > 0 && <Chip>{pending} in queue</Chip>}
          </div>
        </div>
        <div className="screen-header__actions">
          <Button
            icon={<RefreshCw size={16} />}
            disabled={!covers.length || pending > 0}
            onClick={() =>
              void buildAll.mutateAsync(undefined, { onSuccess: () => void statusQuery.refetch() })
                .then((result) => toast('Build queued', { description: `${result.queued} covers`, tone: 'success' }))
                .catch((error: unknown) => toast('Build failed', { description: errorMessage(error), tone: 'error' }))
            }
          >
            Build all
          </Button>
          <Link className="btn btn--secondary btn--md" to={`/shelves/${project.id}/print`}>
            <Printer size={16} /> Print
          </Link>
          <Link className="btn btn--primary btn--md" to={`/shelves/${project.id}/review`}>
            <Sparkles size={16} /> Review
          </Link>
        </div>
      </header>

      {pending > 0 && (
        <div className="progress-banner" role="status">
          <span className="mono">BUILDING</span> {pending} job{pending === 1 ? '' : 's'} in the queue. This banner clears when the worker finishes.
        </div>
      )}

      <div style={{ marginBottom: 26 }}>
        <ImportPanel projectId={project.id} onImported={() => void statusQuery.refetch()} />
        <HouseStylePanel project={project} />
      </div>

      <div className="section-heading">
        <div>
          <h2>Covers</h2>
          <p>Drop front art on a card, or click “Replace art”.</p>
        </div>
      </div>
      <CoverGrid covers={covers} projectId={project.id} busy={pending > 0} />

      <p className="visually-hidden" aria-live="polite">
        {pending === 0 ? 'All builds finished.' : `${pending} builds pending.`}
      </p>
    </div>
  );
}
