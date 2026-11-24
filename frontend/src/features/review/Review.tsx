import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleHelp, Download, Printer, RotateCcw, X } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useDecision, usePatchOverrides, useRenderCover, useRetryCover } from '../../api/mutations';
import { qk, useCoverDetail, useInvalidateOnIdle, useProject } from '../../api/queries';
import { Button, Chip, EmptyState, ErrorPanel, Skeleton, StatusChip } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { isBusy, mergeStatuses } from '../../lib/format';
import type { CoverStatus, Overrides, ProjectDetailResponse } from '../../api/types';
import type { OverrideValues } from '../../lib/schemas';
import { CoverRail } from './CoverRail';
import { OverridePanel } from './OverridePanel';
import { QcPanel } from './QcPanel';
import { Stage, type StageView } from './Stage';
import { useReviewKeys } from './useReviewKeys';

type UndoEntry = { coverId: string; overrides: Overrides; status: CoverStatus };

export function Review() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('cover') ?? '';
  const client = useQueryClient();
  const { toast } = useToast();

  const projectQuery = useProject(id);
  const statusQuery = useInvalidateOnIdle(id);
  const covers = useMemo(
    () => mergeStatuses(projectQuery.data?.covers ?? [], statusQuery.data?.covers ?? []),
    [projectQuery.data?.covers, statusQuery.data?.covers],
  );
  const active = covers.find((cover) => cover.id === selectedId) ?? covers[0] ?? null;
  const detailQuery = useCoverDetail(active?.id ?? '', active?.status);
  const detail = detailQuery.data;
  const cover = active ? { ...active, ...(detail?.cover ?? {}) } : null;

  const [view, setView] = useState<StageView>('wrap');
  const [oneToOne, setOneToOne] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fading, setFading] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [cursor, setCursor] = useState(0);
  const undoRef = useRef<UndoEntry | null>(null);
  const lastRenderRef = useRef<string | null>(null);
  const scrollRef = useRef({ left: 0, top: 0 });

  const decide = useDecision(id);
  const patchOverrides = usePatchOverrides(active?.id ?? '', id);
  const rerender = useRenderCover(id);
  const retry = useRetryCover(id);

  useEffect(() => {
    if (active && active.id !== selectedId) setSearchParams({ cover: active.id }, { replace: true });
  }, [active, selectedId, setSearchParams]);

  useEffect(() => {
    const index = covers.findIndex((item) => item.id === active?.id);
    if (index >= 0) setCursor(index);
  }, [active?.id, covers]);

  useEffect(() => {
    const next = detail?.cover.renderId ?? null;
    if (lastRenderRef.current === null) {
      lastRenderRef.current = next;
      return;
    }
    if (next === lastRenderRef.current) return;
    lastRenderRef.current = next;
    setFading(true);
    const timer = window.setTimeout(() => {
      setFading(false);
      const mat = document.querySelector<HTMLElement>('.review-stage__mat');
      if (mat) {
        mat.scrollLeft = scrollRef.current.left;
        mat.scrollTop = scrollRef.current.top;
      }
      setAnnouncement('New render is ready.');
    }, 180);
    return () => window.clearTimeout(timer);
  }, [detail?.cover.renderId]);

  const remember = useCallback(() => {
    if (!cover) return;
    undoRef.current = { coverId: cover.id, overrides: { ...(detail?.overrides ?? {}) }, status: cover.status };
  }, [cover, detail?.overrides]);

  function applyDecision(decision: 'approved' | 'rejected') {
    if (!cover) return;
    const previous = undoRef.current;
    remember();
    client.setQueryData<ProjectDetailResponse>(qk.project(id), (old) =>
      old ? { ...old, covers: old.covers.map((item) => (item.id === cover.id ? { ...item, status: decision } : item)) } : old,
    );
    setAnnouncement(decision === 'approved' ? 'Cover approved.' : 'Cover rejected.');
    decide.mutate(
      { coverId: cover.id, decision },
      {
        onError: (error) => {
          if (previous) undoRef.current = previous;
          toast('Decision failed', { description: errorMessage(error), tone: 'error' });
          void statusQuery.refetch();
        },
      },
    );
  }

  function applyRender(values: OverrideValues) {
    if (!cover) return;
    remember();
    rerender.mutate(
      { coverId: cover.id, overrides: values as Overrides },
      {
        onSuccess: () => setAnnouncement('Re-render queued. This costs no quota.'),
        onError: (error) => toast('Re-render failed', { description: errorMessage(error), tone: 'error' }),
      },
    );
  }

  function applyRetry() {
    if (!cover) return;
    remember();
    retry.mutate(cover.id, {
      onSuccess: () => setAnnouncement('Running all steps again — metadata, art, and render will be re-fetched.'),
      onError: (error) => toast('Retry failed', { description: errorMessage(error), tone: 'error' }),
    });
  }

  function applySave(values: OverrideValues) {
    if (!cover) return;
    remember();
    patchOverrides.mutate(values as Overrides, {
      onSuccess: () => {
        setAnnouncement('Adjustments saved.');
        toast('Adjustments saved', { tone: 'success' });
      },
      onError: (error) => toast('Save failed', { description: errorMessage(error), tone: 'error' }),
    });
  }

  function undo() {
    const entry = undoRef.current;
    if (!entry) {
      setAnnouncement('Nothing to undo.');
      return;
    }
    undoRef.current = null;
    void patchOverrides.mutateAsync(entry.overrides).then(() => {
      if (entry.status === 'approved' || entry.status === 'rejected') {
        return decide.mutateAsync({ coverId: entry.coverId, decision: entry.status });
      }
      return undefined;
    }).then(() => {
      setAnnouncement('Last change undone.');
      void statusQuery.refetch();
    }).catch((error: unknown) => toast('Undo failed', { description: errorMessage(error), tone: 'error' }));
  }

  const keys = useMemo(
    () => ({
      move: (delta: number) => {
        if (!covers.length) return;
        setCursor((current) => {
          const next = Math.min(covers.length - 1, Math.max(0, current + delta));
          return next;
        });
      },
      select: () => {
        const chosen = covers[cursor];
        if (chosen) setSearchParams({ cover: chosen.id });
      },
      approve: () => applyDecision('approved'),
      reject: () => applyDecision('rejected'),
      render: () => {
        if (!cover) return;
        applyRender({
          title: detail?.overrides.title ?? cover.title,
          titleSize: detail?.overrides.titleSize ?? 18,
          titleAnchor: detail?.overrides.titleAnchor ?? 'top',
          titleAlign: detail?.overrides.titleAlign ?? 'left',
          zoom: detail?.overrides.zoom ?? 1,
          offX: detail?.overrides.offX ?? 0,
          offY: detail?.overrides.offY ?? 0,
          ribbon: detail?.overrides.ribbon ?? '',
          subtitle: detail?.overrides.subtitle ?? '',
        });
      },
      undo,
      help: () => setHelpOpen(true),
      escape: () => setHelpOpen(false),
    }),
    // Handlers are intentionally re-created with their data; the key listener follows them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [covers, cursor, cover, detail?.overrides, id, setSearchParams],
  );
  useReviewKeys(keys);

  if (projectQuery.isPending) {
    return (
      <div className="screen">
        <Skeleton className="skeleton--title" />
        <div className="review-layout">
          <Skeleton className="skeleton--rail" />
          <Skeleton className="skeleton--stage" />
          <Skeleton className="skeleton--inspector" />
        </div>
      </div>
    );
  }
  if (projectQuery.isError || !projectQuery.data) {
    return (
      <div className="screen">
        <ErrorPanel message={errorMessage(projectQuery.error)} onRetry={() => void projectQuery.refetch()} />
        <p className="subtle" style={{ marginTop: 12 }}><Link to="/">← Back to shelves</Link></p>
      </div>
    );
  }

  const project = projectQuery.data.project;
  const allApproved = covers.length > 0 && covers.every((item) => item.status === 'approved' || item.status === 'auto_approved');

  return (
    <div className="screen review-screen">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Shelves</Link> / <Link to={`/shelves/${id}`}>{project.name}</Link> / <span>Review</span>
      </nav>

      <header className="screen-header">
        <div>
          <p className="eyebrow">Review · {project.platform}</p>
          <h1>{project.name}</h1>
          <div className="chip-row">
            <Chip tone="accent">{covers.length} covers</Chip>
            <Chip tone="ok">{covers.filter((item) => item.status === 'approved' || item.status === 'auto_approved').length} ready</Chip>
            <Button size="sm" variant="ghost" icon={<CircleHelp size={14} />} onClick={() => setHelpOpen(true)}>
              Shortcuts
            </Button>
          </div>
        </div>
        <div className="screen-header__actions">
          <Button icon={<RotateCcw size={15} />} disabled={!undoRef.current} onClick={undo}>Undo</Button>
          <Link className="btn btn--secondary btn--md" to={`/shelves/${id}/print`}><Printer size={16} /> Print</Link>
        </div>
      </header>

      {allApproved && (
        <div className="progress-banner" role="status">
          <Check size={15} /> Nothing needs review — everything is approved. <Link to={`/shelves/${id}/print`}>Go to print</Link>
        </div>
      )}

      {covers.length === 0 ? (
        <EmptyState
          title="No covers to review"
          body="Add titles to this shelf first. Once renders finish, they appear here for a close look."
          action={<Link className="btn btn--primary btn--md" to={`/shelves/${id}`}>Back to shelf</Link>}
        />
      ) : (
        <div className="review-layout">
          <CoverRail covers={covers} activeId={cover?.id ?? ''} onSelect={(coverId) => setSearchParams({ cover: coverId })} />

          <section className="review-stage" aria-label="Cover stage">
            <div className="review-stage__bar">
              <div className="stage-panels" role="group" aria-label="Panel view">
                {(['wrap', 'front', 'back', 'spine'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={view === option ? 'active' : ''}
                    aria-pressed={view === option}
                    onClick={() => setView(option)}
                  >
                    {option === 'wrap' ? 'Wrap' : option[0].toUpperCase() + option.slice(1)}
                  </button>
                ))}
              </div>
              <Button size="sm" variant={oneToOne ? 'primary' : 'secondary'} aria-pressed={oneToOne} onClick={() => setOneToOne((value) => !value)}>
                1:1
              </Button>
            </div>
            <div
              className={`review-stage__mat ${oneToOne ? 'review-stage__mat--scroll' : ''}`}
              onScroll={(event) => {
                scrollRef.current = { left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
              }}
            >
              {cover ? (
                <Stage cover={cover} view={view} oneToOne={oneToOne} fading={fading} />
              ) : (
                <p className="review-stage__empty">Select a cover in the rail.</p>
              )}
            </div>
            <p className="review-stage__foot mono">
              {oneToOne ? '300 DPI actual pixels · 3260 × 1819 px' : `270 × 148 mm trim · ${view} view`}
              {cover?.renderVersion ? ` · v${cover.renderVersion}` : ''}
            </p>
          </section>

          <aside className="inspector" aria-label="Cover inspector">
            {cover ? (
              <>
                <div className="inspector__head">
                  <div style={{ minWidth: 0 }}>
                    <p className="eyebrow">Selected cover</p>
                    <h2 title={cover.title}>{cover.title}</h2>
                  </div>
                  <StatusChip status={cover.status} />
                </div>
                <QcPanel issues={cover.issues ?? []} score={cover.score} />
                <OverridePanel
                  coverId={cover.id}
                  title={cover.title}
                  overrides={detail?.overrides ?? {}}
                  busy={isBusy(cover.status) || rerender.isPending}
                  onRender={applyRender}
                  onSave={applySave}
                />
                <div className="inspector__footer">
                  <div className="inspector__decision">
                    <Button
                      variant="primary"
                      icon={<Check size={15} />}
                      disabled={decide.isPending}
                      onClick={() => applyDecision('approved')}
                    >
                      Approve
                    </Button>
                    <Button variant="danger" icon={<X size={15} />} disabled={decide.isPending} onClick={() => applyDecision('rejected')}>
                      Reject
                    </Button>
                  </div>
                  {cover.wrapUrl ? (
                    <a className="btn btn--secondary btn--md" href={cover.wrapUrl} download={`${cover.title.replace(/[^\w-]+/g, '-')}-wrap.png`}>
                      <Download size={15} /> Download wrap
                    </a>
                  ) : (
                    <Button disabled icon={<Download size={15} />}>Download wrap</Button>
                  )}
                  {(cover.status === 'needs_review' || cover.status === 'failed' || cover.status === 'rejected') && (
                    <Button
                      variant="ghost"
                      icon={<RotateCcw size={15} />}
                      disabled={retry.isPending}
                      onClick={applyRetry}
                    >
                      Run all steps again
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    disabled={!undoRef.current}
                    icon={<RotateCcw size={15} />}
                    onClick={undo}
                  >
                    Undo last change
                  </Button>
                </div>
              </>
            ) : (
              <div className="inspector__section"><p className="subtle">Select a cover to inspect it.</p></div>
            )}
          </aside>
        </div>
      )}

      <p className="visually-hidden" aria-live="polite">{announcement}</p>

      {helpOpen && (
        <div className="dialog-overlay" onClick={() => setHelpOpen(false)}>
          <div className="dialog-content" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={(event) => event.stopPropagation()}>
            <h2 className="dialog-title">Shortcuts</h2>
            <p className="dialog-description">Review without touching the mouse.</p>
            <div className="shortcuts">
              <dl>
                <dt>j / k</dt><dd>Next / previous cover in the rail</dd>
                <dt>Enter</dt><dd>Open the highlighted cover</dd>
                <dt>a / r</dt><dd>Approve / reject</dd>
                <dt>⌘/Ctrl + Enter</dt><dd>Re-render (free)</dd>
                <dt>⌘/Ctrl + Z</dt><dd>Undo last change</dd>
                <dt>?</dt><dd>Show this list</dd>
                <dt>Esc</dt><dd>Close this list</dd>
              </dl>
            </div>
            <div className="dialog-footer"><Button onClick={() => setHelpOpen(false)}>Close</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
