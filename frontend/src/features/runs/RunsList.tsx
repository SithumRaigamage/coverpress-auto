/** Pipeline runs — every recent build, newest first. Live while anything is running. */
import { Link } from 'react-router';
import { Trash2, X } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useClearRuns, useDeleteRun } from '../../api/mutations';
import { useRuns } from '../../api/queries';
import type { RunSummary } from '../../api/types';
import { Button, ButtonLink, EmptyState, ErrorPanel, IconButton, PageHeader, Pill, Skeleton } from '../../components/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/Toast';
import { relative, STATUS_META, type Tone } from '../../lib/status';

function runBadge(r: RunSummary): { tone: Tone; label: string } {
  if (r.state === 'running') return { tone: 'accent', label: `Step ${Math.max(1, r.step)} of ${r.totalSteps}` };
  if (r.state === 'queued') return { tone: 'neutral', label: 'Queued' };
  if (r.state === 'failed') return { tone: 'danger', label: 'Failed' };
  return STATUS_META[r.coverStatus];
}

export function RunsList() {
  const runs = useRuns();
  const deleteRun = useDeleteRun();
  const clearRuns = useClearRuns();
  const toast = useToast();
  const finished = runs.data?.runs.filter((r) => r.state === 'done' || r.state === 'failed').length ?? 0;

  const remove = (r: RunSummary) =>
    deleteRun.mutate(r.id, {
      onSuccess: (res) => toast(res.cancelled ? `Run for ${r.title} cancelled.` : `Run for ${r.title} removed from the history.`, 'success'),
      onError: (e) => toast(errorMessage(e), 'error'),
    });

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <PageHeader
        title="Pipeline runs"
        subtitle={runs.data ? `${runs.data.active} running or queued. Each run fetches, renders and checks one cover.` : 'Loading…'}
        actions={
          <>
            {finished > 0 && (
              <ConfirmDialog
                title={`Clear ${finished} finished run${finished === 1 ? '' : 's'}?`}
                description="Finished and failed runs leave the history. Covers and their versions stay; running and queued runs are kept."
                confirmLabel="Clear history"
                onConfirm={() =>
                  clearRuns.mutate(undefined, {
                    onSuccess: (r) => toast(`${r.deleted} run${r.deleted === 1 ? '' : 's'} cleared.`, 'success'),
                    onError: (e) => toast(errorMessage(e), 'error'),
                  })
                }
                trigger={
                  <Button variant="danger" icon={<Trash2 size={16} aria-hidden />}>
                    Clear history
                  </Button>
                }
              />
            )}
            <ButtonLink to="/">Back to the library</ButtonLink>
          </>
        }
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
              <li key={r.id} className="flex items-center gap-1 pr-2 hover:bg-raised">
                <Link to={`/runs/${r.coverId}`} className="flex min-h-16 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 py-3 pl-4">
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
                {r.state === 'running' ? (
                  <span className="size-11 shrink-0" aria-hidden />
                ) : r.state === 'queued' ? (
                  <ConfirmDialog
                    title={`Cancel the run for ${r.title}?`}
                    description="The run hasn't started, so nothing is lost. The cover keeps its existing versions."
                    confirmLabel="Cancel run"
                    onConfirm={() => remove(r)}
                    trigger={
                      <IconButton label={`Cancel the run for ${r.title}`} className="shrink-0 hover:text-danger">
                        <X size={16} aria-hidden />
                      </IconButton>
                    }
                  />
                ) : (
                  <ConfirmDialog
                    title="Remove this run from the history?"
                    description={`Only the run record for ${r.title} goes. The cover and its versions stay.`}
                    confirmLabel="Remove run"
                    onConfirm={() => remove(r)}
                    trigger={
                      <IconButton label={`Remove the run for ${r.title} from the history`} className="shrink-0 hover:text-danger">
                        <Trash2 size={16} aria-hidden />
                      </IconButton>
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
