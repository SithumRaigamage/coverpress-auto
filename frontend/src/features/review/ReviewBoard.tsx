/** Screen 4 — Review board. Five columns, optimistic decisions, keyboard: A approve, R run again, J/K move. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Printer } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useDecision, useReplay, useRetry, useUploadFront } from '../../api/mutations';
import { useCovers, useProjects } from '../../api/queries';
import type { Cover } from '../../api/types';
import { Button, ButtonLink, CoverThumb, ErrorPanel, PageHeader, Select, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/cn';
import { boardColumn, canRetry, isPrintable, type BoardColumn } from '../../lib/status';

const COLUMNS: Array<{ key: BoardColumn; label: string; dot: string }> = [
  { key: 'queued', label: 'Queued', dot: 'bg-faint' },
  { key: 'building', label: 'Building', dot: 'bg-info' },
  { key: 'review', label: 'Needs review', dot: 'bg-warning' },
  { key: 'approved', label: 'Approved', dot: 'bg-success' },
  { key: 'failed', label: 'Failed', dot: 'bg-danger' },
];

export function ReviewBoard() {
  const [params, setParams] = useSearchParams();
  const shelf = params.get('shelf') || '';
  const covers = useCovers(shelf || undefined);
  const projects = useProjects();
  const decision = useDecision();
  const retry = useRetry();
  const replay = useReplay();
  const toast = useToast();
  const [focusId, setFocusId] = useState<string | null>(params.get('cover'));
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const byColumn = useMemo(() => {
    const out: Record<BoardColumn, Cover[]> = { queued: [], building: [], review: [], approved: [], failed: [] };
    for (const c of covers.data?.covers || []) out[boardColumn(c.status)].push(c);
    return out;
  }, [covers.data]);
  const ordered = useMemo(() => COLUMNS.flatMap((col) => byColumn[col.key]), [byColumn]);
  const printable = ordered.filter((c) => isPrintable(c.status)).length;

  const approve = useCallback(
    (c: Cover) =>
      decision.mutate(
        { coverId: c.id, decision: 'approved' },
        { onSuccess: () => toast(`${c.title} approved.`, 'success'), onError: (e) => toast(`Could not approve ${c.title}: ${errorMessage(e)}`, 'error') },
      ),
    [decision, toast],
  );
  const runAgain = useCallback(
    (c: Cover) => {
      const fn = canRetry(c.status) ? retry : replay;
      fn.mutate(c.id, { onError: (e) => toast(`Could not re-run ${c.title}: ${errorMessage(e)}`, 'error') });
    },
    [retry, replay, toast],
  );

  // Deep link (?cover=) focuses that card once the board has loaded.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || !focusId || !covers.data) return;
    deepLinked.current = true;
    cardRefs.current.get(focusId)?.focus();
  }, [focusId, covers.data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (!['a', 'r', 'j', 'k'].includes(key) || !ordered.length) return;
      const index = Math.max(0, ordered.findIndex((c) => c.id === focusId));
      const current = ordered[index];
      e.preventDefault();
      if (key === 'j' || key === 'k') {
        const next = ordered[Math.min(ordered.length - 1, Math.max(0, index + (key === 'j' ? 1 : -1)))];
        setFocusId(next.id);
        cardRefs.current.get(next.id)?.focus();
      } else if (key === 'a' && current && boardColumn(current.status) === 'review') {
        approve(current);
      } else if (key === 'r' && current && !['queued', 'processing'].includes(current.status)) {
        runAgain(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, focusId, approve, runAgain]);

  const printTo = shelf ? `/print/${shelf}` : '/print';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Review queue"
        subtitle={
          <>
            Approve what looks right, run again what doesn’t. Keyboard: <Kbd>J</Kbd>/<Kbd>K</Kbd> move, <Kbd>A</Kbd> approve, <Kbd>R</Kbd> run again.
          </>
        }
        actions={
          <>
            <Select
              label="Shelf"
              value={shelf}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('shelf', e.target.value);
                else next.delete('shelf');
                next.delete('cover');
                setParams(next, { replace: true });
              }}
            >
              <option value="">All shelves</option>
              {(projects.data?.projects || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <ButtonLink variant="primary" to={printTo} icon={<Printer size={16} aria-hidden />} aria-disabled={!printable}>
              Print approved ({printable})
            </ButtonLink>
          </>
        }
      />

      {covers.isError ? (
        <ErrorPanel message={errorMessage(covers.error)} onRetry={() => void covers.refetch()} />
      ) : (
        <div className="scroll-thin -mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
          <div className="grid min-w-[1080px] grid-cols-5 gap-3">
            {COLUMNS.map((col) => (
              <section key={col.key} aria-labelledby={`col-${col.key}`} className="flex min-h-[50vh] flex-col rounded-panel border border-line bg-surface/60">
                <h2 id={`col-${col.key}`} className="flex items-center gap-2 border-b border-line px-3 py-2.5 text-[13px] font-semibold">
                  <span aria-hidden className={cn('size-2 rounded-full', col.dot)} />
                  {col.label}
                  <span className="ml-auto font-mono text-[11px] font-normal text-faint">{covers.data ? byColumn[col.key].length : '–'}</span>
                </h2>
                <div className="flex flex-col gap-2 p-2">
                  {!covers.data ? (
                    <Skeleton className="h-28" />
                  ) : byColumn[col.key].length === 0 ? (
                    <p className="px-1 py-4 text-center text-xs text-faint">Nothing here.</p>
                  ) : (
                    byColumn[col.key].map((c) => (
                      <BoardCard
                        key={c.id}
                        cover={c}
                        focused={focusId === c.id}
                        onFocus={() => setFocusId(c.id)}
                        refCb={(el) => {
                          if (el) cardRefs.current.set(c.id, el);
                          else cardRefs.current.delete(c.id);
                        }}
                        onApprove={() => approve(c)}
                        onRunAgain={() => runAgain(c)}
                      />
                    ))
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      {covers.data && covers.data.covers.length === 0 && (
        <p className="text-center text-sm text-muted">
          No covers yet. <Link to="/" className="text-accent underline underline-offset-2">Generate one from the library</Link>.
        </p>
      )}
    </div>
  );
}

function BoardCard({
  cover,
  focused,
  onFocus,
  refCb,
  onApprove,
  onRunAgain,
}: {
  cover: Cover;
  focused: boolean;
  onFocus: () => void;
  refCb: (el: HTMLElement | null) => void;
  onApprove: () => void;
  onRunAgain: () => void;
}) {
  const column = boardColumn(cover.status);
  const issue = cover.error || cover.issues.find((i) => i.level === 'fail')?.msg || cover.issues.find((i) => i.level === 'warn')?.msg;
  const scoreTone = cover.score === null ? 'text-faint' : cover.score >= 80 ? 'text-success-text' : cover.score >= 60 ? 'text-warning-text' : 'text-danger';

  return (
    <article
      ref={refCb}
      tabIndex={0}
      onFocus={onFocus}
      aria-label={`${cover.title}, ${cover.platform}, ${column === 'review' ? 'needs review' : column}`}
      className={cn(
        'flex flex-col gap-2 rounded-card border bg-raised p-2.5 outline-none transition-colors',
        focused ? 'border-accent ring-1 ring-accent' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex gap-2.5">
        <CoverThumb src={cover.thumbUrl} alt={`${cover.title} front`} className="w-14 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold" title={cover.title}>
            <Link to={`/runs/${cover.id}`} className="hover:text-accent">
              {cover.title}
            </Link>
          </h3>
          <p className="text-xs text-muted">
            {cover.platform} · {cover.renderVersion ? `v${cover.renderVersion}` : 'not rendered'}
          </p>
          <p className="mt-0.5 text-xs">
            <span className="text-faint">QC </span>
            <span className={cn('font-mono', scoreTone)}>{cover.score ?? '—'}</span>
          </p>
        </div>
      </div>

      {issue && (column === 'review' || column === 'failed') && (
        <p className={cn('rounded-control border px-2 py-1.5 text-xs leading-snug', column === 'failed' ? 'border-danger/35 bg-danger/8 text-danger' : 'border-warning/35 bg-warning/8 text-warning-text')}>
          {issue}
        </p>
      )}

      {column === 'review' && (
        <div className="flex gap-1.5">
          <Button size="sm" variant="success" className="flex-1" onClick={onApprove} aria-label={`Approve ${cover.title}`}>
            Approve
          </Button>
          <Button size="sm" className="flex-1" onClick={onRunAgain} aria-label={`Run ${cover.title} again`}>
            Run again
          </Button>
        </div>
      )}
      {column === 'failed' && (
        <Button size="sm" variant="danger" onClick={onRunAgain} aria-label={`Retry all steps for ${cover.title}`}>
          Retry all steps
        </Button>
      )}
      {(column === 'queued' || column === 'building') && (
        <ButtonLink size="sm" variant="ghost" to={`/runs/${cover.id}`} aria-label={`Watch the run for ${cover.title}`}>
          Watch run
        </ButtonLink>
      )}
      {column === 'approved' && (
        <Button size="sm" variant="ghost" onClick={onRunAgain} aria-label={`Run ${cover.title} again`}>
          Run again
        </Button>
      )}
      {(column === 'review' || column === 'failed') && <ArtOverride cover={cover} />}
    </article>
  );
}

/** The hidden override: replace front art with a file. Off the main flow on purpose. */
function ArtOverride({ cover }: { cover: Cover }) {
  const upload = useUploadFront();
  const toast = useToast();
  return (
    <details className="text-xs text-faint">
      <summary className="flex min-h-11 cursor-pointer items-center rounded-control px-1 hover:text-muted">Override front art…</summary>
      <label className="flex flex-col gap-1 px-1 pb-1">
        <span>PNG, JPEG or WebP, at least 1512 × 1748 px for a sharp print.</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={upload.isPending}
          className="text-xs text-muted file:mr-2 file:min-h-11 file:rounded-control file:border file:border-line-strong file:bg-surface file:px-3 file:text-text"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            upload.mutate(
              { coverId: cover.id, file },
              { onSuccess: () => toast(`New art uploaded for ${cover.title}; rebuilding.`, 'success'), onError: (err) => toast(errorMessage(err), 'error') },
            );
          }}
        />
      </label>
    </details>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-control border border-line-strong px-1 font-mono text-[11px] text-text">{children}</kbd>;
}
