/** Pipeline runs — every recent build, newest first. Live while anything is running. */
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import { useRuns } from '../../api/queries';
import type { RunSummary } from '../../api/types';
import { ButtonLink, EmptyState, ErrorPanel, PageHeader, Pill, Skeleton } from '../../components/ui';
import { relative, STATUS_META, type Tone } from '../../lib/status';

function runBadge(r: RunSummary): { tone: Tone; label: string } {
  if (r.state === 'running') return { tone: 'accent', label: `Step ${Math.max(1, r.step)} of ${r.totalSteps}` };
  if (r.state === 'queued') return { tone: 'neutral', label: 'Queued' };
  if (r.state === 'failed') return { tone: 'danger', label: 'Failed' };
  return STATUS_META[r.coverStatus];
}

export function RunsList() {
  const runs = useRuns();
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <PageHeader
        title="Pipeline runs"
        subtitle={runs.data ? `${runs.data.active} running or queued. Each run fetches, renders and checks one cover.` : 'Loading…'}
        actions={<ButtonLink to="/">Back to the library</ButtonLink>}
      />
      {runs.isError ? (
        <ErrorPanel message={errorMessage(runs.error)} onRetry={() => void runs.refetch()} />
      ) : !runs.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : runs.data.runs.length === 0 ? (
        <EmptyState title="No runs yet" action={<ButtonLink variant="primary" to="/">Pick a game</ButtonLink>}>
          Generate a cover from the game library and its run appears here.
        </EmptyState>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface">
          {runs.data.runs.map((r) => {
            const b = runBadge(r);
            return (
              <li key={r.id}>
                <Link to={`/runs/${r.coverId}`} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-raised">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {r.platform} · {r.state === 'running' && r.currentLabel ? r.currentLabel : r.lastError && r.state === 'failed' ? r.lastError : relative(r.finishedAt || r.createdAt)}
                    </span>
                  </span>
                  <Pill tone={b.tone} dot>
                    {b.label}
                  </Pill>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
