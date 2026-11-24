/** Screen 3 — Pipeline run. Seven steps, a live log and the real wrap once rendered. Polls every second while active. */
import { useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { Check, ChevronRight, RotateCcw, X } from 'lucide-react';
import { errorMessage } from '../../api/client';
import { useReplay } from '../../api/mutations';
import { useCoverRun } from '../../api/queries';
import type { CoverRun, LogLine, RunStep } from '../../api/types';
import { Button, ButtonLink, Card, Chip, ErrorPanel, Pill, ProgressBar, Skeleton } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { cn } from '../../lib/cn';
import { isBusy, runProgress, timeOfDay, type Tone } from '../../lib/status';

export function RunScreen() {
  const { coverId = '' } = useParams();
  const run = useCoverRun(coverId);
  if (run.isError) {
    return (
      <div className="mx-auto max-w-[1400px]">
        <ErrorPanel message={errorMessage(run.error)} onRetry={() => void run.refetch()} />
      </div>
    );
  }
  if (!run.data) return <RunSkeleton />;
  return <Run data={run.data} />;
}

function badge(data: CoverRun): { tone: Tone; label: string } {
  const job = data.run;
  if (job && (job.state === 'running' || job.state === 'queued') ) {
    return job.state === 'queued' ? { tone: 'neutral', label: 'Queued' } : { tone: 'accent', label: `Running · step ${Math.max(1, job.step)} of ${job.totalSteps}` };
  }
  switch (data.cover.status) {
    case 'auto_approved':
      return { tone: 'success', label: 'Auto-approved' };
    case 'approved':
      return { tone: 'success', label: 'Approved' };
    case 'needs_review':
      return { tone: 'warning', label: 'Needs review' };
    case 'failed':
    case 'rejected':
      return { tone: 'danger', label: data.cover.status === 'rejected' ? 'Rejected' : 'Failed' };
    default:
      return isBusy(data.cover.status) ? { tone: 'neutral', label: 'Queued' } : { tone: 'neutral', label: data.cover.status };
  }
}

function Run({ data }: { data: CoverRun }) {
  const { cover, run, render, qc } = data;
  const replay = useReplay();
  const toast = useToast();
  const b = badge(data);
  const steps: RunStep[] = run?.steps || data.steps.map((s) => ({ ...s, state: 'pending' as const, detail: '' }));
  const active = run?.state === 'queued' || run?.state === 'running';
  const progress = run ? (run.state === 'done' ? 1 : runProgress(steps)) : 0;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <nav aria-label="Breadcrumb">
        <ol className="flex items-center gap-1 text-sm text-muted">
          <li>
            <Link to="/runs" className="hover:text-text">
              Pipeline runs
            </Link>
          </li>
          <li aria-hidden>
            <ChevronRight size={14} />
          </li>
          <li aria-current="page" className="truncate text-text">
            {cover.title}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[26px] leading-tight font-semibold">{cover.title}</h1>
              <span aria-live="polite">
                <Pill tone={b.tone} dot>
                  {b.label}
                </Pill>
              </span>
            </div>
            <p className="mt-1 text-sm text-muted">
              {cover.platform} · {cover.style === 'raw' ? 'Raw image' : cover.style === 'minimal' ? 'Minimal' : 'Standard'} layout
              {cover.projectName ? ` · ${cover.projectName}` : ''}
              {render ? ` · v${render.version}` : ''}
              {run && run.attempts > 1 ? ` · attempt ${run.attempts} of ${run.maxAttempts}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<RotateCcw size={16} aria-hidden />}
              disabled={active || replay.isPending}
              onClick={() => replay.mutate(cover.id, { onError: (e) => toast(errorMessage(e), 'error') })}
            >
              Replay run
            </Button>
            <ButtonLink variant="primary" to={`/review?cover=${cover.id}`}>
              Go to review
            </ButtonLink>
          </div>
        </div>
        <ProgressBar value={progress} label="Pipeline progress" />
        {cover.error && !active && (
          <p role="alert" className="rounded-card border border-danger/40 bg-danger/8 px-4 py-2 text-sm text-danger">
            {cover.error}
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <Card className="p-2 lg:self-start">
          <ol aria-label="Pipeline steps">
            {steps.map((s, i) => (
              <StepRow key={s.key} step={s} index={i + 1} last={i === steps.length - 1} />
            ))}
          </ol>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[15px] font-semibold">Wrap preview</h2>
              <span className="font-mono text-[11px] text-faint">
                {data.print.trimMm.width} × {data.print.trimMm.height} mm · {data.print.bleedMm} mm bleed · {data.print.dpi} DPI
              </span>
            </div>
            <WrapPreview data={data} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-2 text-[15px] font-semibold">Quality checks</h2>
            {qc ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Quality check results">
                <li>
                  <Chip tone={(qc.score ?? 0) >= 80 ? 'success' : (qc.score ?? 0) >= 60 ? 'warning' : 'danger'}>Score {qc.score ?? '—'}</Chip>
                </li>
                {(qc.issues || []).length === 0 ? (
                  <li>
                    <Chip tone="success">No issues</Chip>
                  </li>
                ) : (
                  (qc.issues || []).map((issue) => (
                    <li key={issue.code + issue.msg}>
                      <span
                        className={cn(
                          'inline-flex rounded-control border px-2 py-0.5 text-xs',
                          issue.level === 'fail' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-warning/35 bg-warning/10 text-warning-text',
                        )}
                      >
                        {issue.msg}
                      </span>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              <p className="text-sm text-faint">Checks run after the wrap is rendered.</p>
            )}
          </Card>

          <LogPanel lines={run?.log || []} live={active} />
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, index, last }: { step: RunStep; index: number; last: boolean }) {
  const STATE_TEXT: Record<RunStep['state'], string> = {
    pending: 'Waiting',
    running: 'Running',
    done: 'Done',
    skipped: 'Skipped',
    failed: 'Failed',
  };
  return (
    <li className="relative flex gap-3 px-3 py-3" aria-current={step.state === 'running' ? 'step' : undefined}>
      {!last && <span aria-hidden className="absolute top-12 bottom-0 left-[29px] w-px bg-line" />}
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold',
          step.state === 'done' && 'border-success bg-success/15 text-success-text',
          step.state === 'skipped' && 'border-line-strong bg-raised text-faint',
          step.state === 'running' && 'border-accent text-accent ring-4 ring-accent/20',
          step.state === 'failed' && 'border-danger bg-danger/15 text-danger',
          step.state === 'pending' && 'border-line-strong text-faint',
        )}
      >
        {step.state === 'done' ? <Check size={15} strokeWidth={3} /> : step.state === 'failed' ? <X size={15} strokeWidth={3} /> : index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={cn('text-sm font-medium', step.state === 'pending' ? 'text-muted' : 'text-text')}>{step.label}</span>
          <span
            className={cn(
              'shrink-0 text-xs',
              step.state === 'running' ? 'progress-indeterminate text-accent' : step.state === 'failed' ? 'text-danger' : step.state === 'done' ? 'text-success-text' : 'text-faint',
            )}
          >
            {STATE_TEXT[step.state]}
          </span>
        </div>
        {step.detail && <p className="mt-0.5 text-xs break-words text-muted">{step.detail}</p>}
      </div>
    </li>
  );
}

/** Back | spine | front at 270:148. The real render once ready; a proportioned placeholder before. */
function WrapPreview({ data }: { data: CoverRun }) {
  const { render, cover } = data;
  if (render) {
    return (
      <a href={render.wrapUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-control bg-black">
        <img
          key={render.id}
          src={render.wrapUrl}
          alt={`Full wrap for ${cover.title}, ${cover.platform}, version ${render.version}: back, spine and front`}
          className="block h-auto w-full"
        />
      </a>
    );
  }
  return (
    <div className="wrap-frame flex overflow-hidden rounded-control border border-dashed border-line-strong" role="img" aria-label="Wrap not rendered yet">
      <div className="flex flex-[128] items-center justify-center bg-raised/40 text-xs text-faint">Back</div>
      <div className="flex flex-[14] items-center justify-center border-x border-dashed border-line-strong bg-raised/70 text-[10px] text-faint [writing-mode:vertical-rl]">
        Spine
      </div>
      <div className="flex flex-[128] items-center justify-center bg-raised/40 text-xs text-faint">
        {isBusy(cover.status) ? 'Rendering…' : 'Front'}
      </div>
    </div>
  );
}

function LogPanel({ lines, live }: { lines: LogLine[]; live: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);
  const TONE: Record<LogLine['level'], string> = { info: 'text-muted', ok: 'text-success-text', warn: 'text-warning-text', error: 'text-danger' };
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <h2 className="font-mono text-[11px] font-semibold tracking-widest text-muted uppercase">
          {live && <span aria-hidden className="progress-indeterminate mr-2 inline-block size-1.5 rounded-full bg-accent align-middle" />}
          Live log
        </h2>
        <span className="font-mono text-[11px] text-faint">{lines.length} lines</span>
      </div>
      <div ref={box} role="log" aria-label="Pipeline log" tabIndex={0} className="scroll-thin max-h-72 overflow-y-auto bg-bg px-4 py-3 font-mono text-[12px] leading-relaxed">
        {lines.length === 0 ? (
          <p className="text-faint">Waiting for the worker…</p>
        ) : (
          lines.map((l, i) => (
            <p key={i} className="break-words">
              <span className="text-faint">{timeOfDay(l.t)}</span> <span className={TONE[l.level] || 'text-muted'}>{l.msg}</span>
            </p>
          ))
        )}
      </div>
    </Card>
  );
}

function RunSkeleton() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6" aria-busy="true" aria-label="Loading run">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-1.5" />
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,380px)_1fr]">
        <Skeleton className="h-96" />
        <Skeleton className="wrap-frame" />
      </div>
    </div>
  );
}
