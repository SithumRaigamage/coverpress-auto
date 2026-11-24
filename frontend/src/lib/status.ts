import type { CoverStatus, Platform, StepState } from '../api/types';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';

export function isBusy(status: CoverStatus | undefined): boolean {
  return status === 'queued' || status === 'processing';
}

export const STATUS_META: Record<CoverStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Building', tone: 'info' },
  auto_approved: { label: 'Auto-approved', tone: 'success' },
  approved: { label: 'Approved', tone: 'success' },
  needs_review: { label: 'In review', tone: 'warning' },
  failed: { label: 'Failed', tone: 'danger' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export type BoardColumn = 'queued' | 'building' | 'review' | 'approved' | 'failed';

/** Which kanban column a cover sits in. Rejected is a decision that needs work, so it lands with failures. */
export function boardColumn(status: CoverStatus): BoardColumn {
  switch (status) {
    case 'queued':
      return 'queued';
    case 'processing':
      return 'building';
    case 'needs_review':
      return 'review';
    case 'approved':
    case 'auto_approved':
      return 'approved';
    default:
      return 'failed';
  }
}

export const isPrintable = (status: CoverStatus) => status === 'approved' || status === 'auto_approved';

/** The server accepts /retry only from these; anything else replays with /build. */
export const canRetry = (status: CoverStatus) => status === 'needs_review' || status === 'failed' || status === 'rejected';

/** Fit score colour: ≥80 green, ≥60 amber, else red. */
export function fitTone(score: number): Tone {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

export function stepTone(state: StepState): Tone {
  return state === 'done' ? 'success' : state === 'running' ? 'accent' : state === 'failed' ? 'danger' : 'neutral';
}

/** Progress through the seven steps; a running step counts as half done. */
export function runProgress(steps: Array<{ state: StepState }>): number {
  if (!steps.length) return 0;
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped' || s.state === 'failed').length;
  const running = steps.some((s) => s.state === 'running') ? 0.5 : 0;
  return Math.min(1, (done + running) / steps.length);
}

/** The platform a library card generates for: the filter if set, else PS5 when RAWG lists it. */
export function primaryPlatform(platforms: string[], filter: '' | Platform): Platform {
  if (filter) return filter;
  return platforms.some((p) => /PlayStation 5/i.test(p)) || !platforms.some((p) => /PlayStation 4/i.test(p)) ? 'PS5' : 'PS4';
}

export function initials(email: string | undefined): string {
  const local = (email || '').split('@')[0].replace(/[^a-z0-9]/gi, '');
  return (local.slice(0, 2) || 'CP').toUpperCase();
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n);
}

export function timeOfDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function relative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.round((now - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(diff)) return '';
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}
