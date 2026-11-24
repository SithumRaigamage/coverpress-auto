import type { Cover, CoverStatus, StatusCover, Usage } from '../api/types';

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function usageLabel(usage: Usage | undefined): string {
  if (!usage) return '—';
  return `${usage.used} of ${usage.limit} covers this month`;
}

export function isBusy(status: CoverStatus | undefined): boolean {
  return status === 'queued' || status === 'processing';
}

/** Polling results are partial; merge them into the full DTO so cards keep their keys. */
export function mergeStatuses(covers: Cover[], statuses: StatusCover[]): Cover[] {
  const byId = new Map(statuses.map((item) => [item.id, item]));
  return covers.map((cover) => {
    const live = byId.get(cover.id);
    if (!live) return cover;
    return {
      ...cover,
      status: live.status,
      renderId: live.renderId ?? cover.renderId,
      renderVersion: live.renderVersion ?? cover.renderVersion,
      score: live.score ?? cover.score,
      error: live.error ?? cover.error,
    };
  });
}

export function countTitles(text: string): number {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#')).length;
}

export const STATUS_LABEL: Record<CoverStatus, string> = {
  queued: 'Queued',
  processing: 'Building',
  auto_approved: 'Auto-approved',
  needs_review: 'Needs review',
  failed: 'Failed',
  approved: 'Approved',
  rejected: 'Rejected',
};
