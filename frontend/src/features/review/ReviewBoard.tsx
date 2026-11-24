/** Screen 4 — Review board. One card per game + platform, its runs as versions.
 *  Optimistic decisions; keyboard: J/K move, A approve the shown version, R run again. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Printer, SlidersHorizontal } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useAdjust, useDecision, useReplay, useRetry, useUploadFront } from '../../api/mutations';
import { useCovers, useProjects } from '../../api/queries';
import type { Cover, CoverVersion, Overrides } from '../../api/types';
import { Button, ButtonLink, CoverThumb, ErrorPanel, PageHeader, Select, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/cn';
import { boardColumn, canRetry, isBusy, isPrintable, type BoardColumn } from '../../lib/status';

const COLUMNS: Array<{ key: BoardColumn; label: string; dot: string }> = [
  { key: 'queued', label: 'Queued', dot: 'bg-faint' },
  { key: 'building', label: 'Building', dot: 'bg-info' },
  { key: 'review', label: 'Needs review', dot: 'bg-warning' },
  { key: 'approved', label: 'Approved', dot: 'bg-success' },
  { key: 'failed', label: 'Failed', dot: 'bg-danger' },
];

/** The version a card shows by default: the approved one, else the newest. */
const defaultVersion = (c: Cover): CoverVersion | undefined =>
  c.versions?.find((v) => v.approved) || c.versions?.[0];

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
  // coverId → the version the reviewer is looking at (and would approve).
  const [shown, setShown] = useState<Record<string, string>>({});
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const byColumn = useMemo(() => {
    const out: Record<BoardColumn, Cover[]> = { queued: [], building: [], review: [], approved: [], failed: [] };
    for (const c of covers.data?.covers || []) out[boardColumn(c.status)].push(c);
    return out;
  }, [covers.data]);
  const ordered = useMemo(() => COLUMNS.flatMap((col) => byColumn[col.key]), [byColumn]);
  const printable = ordered.filter((c) => isPrintable(c.status)).length;

  const versionOf = useCallback(
    (c: Cover) => c.versions?.find((v) => v.id === shown[c.id]) || defaultVersion(c),
    [shown],
  );

  const approve = useCallback(
    (c: Cover) => {
      const v = versionOf(c);
      decision.mutate(
        { coverId: c.id, decision: 'approved', renderId: v?.id },
        {
          onSuccess: () => toast(`${c.title}${v ? ` v${v.version}` : ''} approved.`, 'success'),
          onError: (e) => toast(`Could not approve ${c.title}: ${errorMessage(e)}`, 'error'),
        },
      );
    },
    [decision, toast, versionOf],
  );
  /** Run again = a new variant: next-best art, other screenshots, fresh copy, new layout. */
  const runAgain = useCallback(
    (c: Cover) => {
      const onError = (e: unknown) => toast(`Could not re-run ${c.title}: ${errorMessage(e)}`, 'error');
      if (canRetry(c.status)) retry.mutate(c.id, { onError });
      else replay.mutate({ coverId: c.id, mode: 'variant' }, { onError });
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
      } else if (key === 'r' && current && !isBusy(current.status)) {
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
            One card per game and platform; every run is a version. Keyboard: <Kbd>J</Kbd>/<Kbd>K</Kbd> move, <Kbd>A</Kbd> approve the shown
            version, <Kbd>R</Kbd> run again.
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
          <div className="grid min-w-[1180px] grid-cols-5 gap-3">
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
                        version={versionOf(c)}
                        onShow={(id) => setShown((s) => ({ ...s, [c.id]: id }))}
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
  version,
  onShow,
  focused,
  onFocus,
  refCb,
  onApprove,
  onRunAgain,
}: {
  cover: Cover;
  version: CoverVersion | undefined;
  onShow: (renderId: string) => void;
  focused: boolean;
  onFocus: () => void;
  refCb: (el: HTMLElement | null) => void;
  onApprove: () => void;
  onRunAgain: () => void;
}) {
  const column = boardColumn(cover.status);
  const versions = cover.versions || [];
  const score = version?.score ?? cover.score;
  const issues = version?.issues ?? cover.issues;
  const issue = (column === 'failed' && cover.error) || issues.find((i) => i.level === 'fail')?.msg || issues.find((i) => i.level === 'warn')?.msg;
  const scoreTone = score === null ? 'text-faint' : score >= 80 ? 'text-success-text' : score >= 60 ? 'text-warning-text' : 'text-danger';
  const isApprovedVersion = Boolean(version?.approved) || (column === 'approved' && !cover.approvedRenderId && version?.id === versions[0]?.id);
  const canApprove = (column === 'review' || column === 'approved' || column === 'failed') && version && !isApprovedVersion;

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
        <CoverThumb src={version?.frontUrl || cover.thumbUrl} alt={`${cover.title} front${version ? `, version ${version.version}` : ''}`} className="w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold" title={cover.title}>
            <Link to={`/runs/${cover.id}`} className="hover:text-accent">
              {cover.title}
            </Link>
          </h3>
          <p className="text-xs text-muted">
            {cover.platform} · {version ? `v${version.version}` : 'not rendered'}
            {isApprovedVersion && <span className="ml-1 text-success-text">· approved</span>}
          </p>
          <p className="mt-0.5 text-xs">
            <span className="text-faint">QC </span>
            <span className={cn('font-mono', scoreTone)}>{score ?? '—'}</span>
          </p>
          {version?.front && (
            <p className="truncate text-[11px] text-faint" title={`${version.front.source} ${version.front.kind}`}>
              {version.front.source} · {version.front.kind}
            </p>
          )}
        </div>
      </div>

      {versions.length > 1 && (
        <div role="radiogroup" aria-label={`Versions of ${cover.title}`} className="scroll-thin flex gap-1 overflow-x-auto pb-0.5">
          {[...versions].reverse().map((v) => {
            const active = v.id === version?.id;
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={`Show version ${v.version}${v.approved ? ', approved' : ''}`}
                onClick={() => onShow(v.id)}
                className={cn(
                  'min-h-9 min-w-9 shrink-0 rounded-control border px-1.5 font-mono text-[11px]',
                  active ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong text-muted hover:text-text',
                  v.approved && !active && 'border-success/60 text-success-text',
                )}
              >
                v{v.version}
              </button>
            );
          })}
        </div>
      )}

      {issue && (column === 'review' || column === 'failed') && (
        <p className={cn('rounded-control border px-2 py-1.5 text-xs leading-snug', column === 'failed' ? 'border-danger/35 bg-danger/8 text-danger' : 'border-warning/35 bg-warning/8 text-warning-text')}>
          {issue}
        </p>
      )}

      {(column === 'review' || column === 'failed' || column === 'approved') && (
        <div className="flex gap-1.5">
          {canApprove && (
            <Button size="sm" variant="success" className="flex-1" onClick={onApprove} aria-label={`Approve ${cover.title} version ${version?.version}`}>
              Approve v{version?.version}
            </Button>
          )}
          <Button
            size="sm"
            variant={column === 'failed' ? 'danger' : 'secondary'}
            className="flex-1"
            onClick={onRunAgain}
            aria-label={column === 'failed' ? `Retry all steps for ${cover.title}` : `Run ${cover.title} again`}
            title="A new version: next-best art, other screenshots, fresh copy, new layout"
          >
            {column === 'failed' ? 'Retry all steps' : 'Run again'}
          </Button>
        </div>
      )}
      {(column === 'queued' || column === 'building') && (
        <ButtonLink size="sm" variant="ghost" to={`/runs/${cover.id}`} aria-label={`Watch the run for ${cover.title}`}>
          Watch run
        </ButtonLink>
      )}
      {versions.length > 0 && !isBusy(cover.status) && <AdjustPanel cover={cover} />}
      {(column === 'review' || column === 'failed') && <ArtOverride cover={cover} />}
    </article>
  );
}

const ADJUST: Array<{ key: 'zoom' | 'offX' | 'offY' | 'titleSize'; label: string; min: number; max: number; step: number; unit: string; fallback: number }> = [
  { key: 'zoom', label: 'Zoom', min: 1, max: 2.5, step: 0.05, unit: '×', fallback: 1 },
  { key: 'offX', label: 'Offset X', min: -30, max: 30, step: 1, unit: 'mm', fallback: 0 },
  { key: 'offY', label: 'Offset Y', min: -30, max: 30, step: 1, unit: 'mm', fallback: 0 },
  { key: 'titleSize', label: 'Title size', min: 7, max: 26, step: 0.5, unit: 'mm', fallback: 15 },
];

/** Inline adjust: overrides through the existing render API. Same art; makes a new version. */
function AdjustPanel({ cover }: { cover: Cover }) {
  const adjust = useAdjust();
  const toast = useToast();
  const initial = () => Object.fromEntries(ADJUST.map((a) => [a.key, Number(cover.overrides?.[a.key] ?? a.fallback)])) as Record<(typeof ADJUST)[number]['key'], number>;
  const [values, setValues] = useState(initial);
  const changed = ADJUST.some((a) => values[a.key] !== Number(cover.overrides?.[a.key] ?? a.fallback));

  return (
    <details className="text-xs">
      <summary className="flex min-h-11 cursor-pointer items-center gap-1.5 rounded-control px-1 text-muted hover:text-text">
        <SlidersHorizontal size={14} aria-hidden /> Adjust
      </summary>
      <form
        className="flex flex-col gap-2 px-1 pb-1"
        onSubmit={(e) => {
          e.preventDefault();
          const overrides: Overrides = { ...values };
          adjust.mutate(
            { coverId: cover.id, overrides },
            {
              onSuccess: () => toast(`Re-rendering ${cover.title} with your adjustments (same art).`, 'success'),
              onError: (err) => toast(errorMessage(err), 'error'),
            },
          );
        }}
      >
        {ADJUST.map((a) => (
          <label key={a.key} className="flex flex-col gap-0.5">
            <span className="flex justify-between text-faint">
              <span>{a.label}</span>
              <span className="font-mono text-muted">
                {values[a.key]}
                {a.unit}
              </span>
            </span>
            <input
              type="range"
              min={a.min}
              max={a.max}
              step={a.step}
              value={values[a.key]}
              aria-label={`${a.label} for ${cover.title}`}
              onChange={(e) => setValues((v) => ({ ...v, [a.key]: Number(e.target.value) }))}
              className="h-6 w-full accent-[var(--cp-accent)]"
            />
          </label>
        ))}
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" className="flex-1" disabled={adjust.isPending} title="Re-render with the same art and copy">
            {changed ? 'Apply' : 'Run again with same art'}
          </Button>
          {changed && (
            <Button size="sm" variant="ghost" onClick={() => setValues(initial())}>
              Reset
            </Button>
          )}
        </div>
      </form>
    </details>
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
