import { describe, expect, it } from 'vitest';
import { countTitles, isBusy, mergeStatuses } from './format';
import type { Cover } from '../api/types';

const cover: Cover = {
  id: 'c1',
  projectId: 'p1',
  title: 'Hollow Knight',
  platform: 'PS5',
  mode: 'auto',
  status: 'queued',
  error: null,
  score: null,
  issues: [],
  decidedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  renderId: null,
  renderVersion: null,
  artUrl: null,
  thumbUrl: null,
  wrapUrl: null,
};

describe('countTitles', () => {
  it('ignores blank lines and comments', () => {
    expect(countTitles('A | PS5 | auto\n\n# note\nB | PS4 | manual\n')).toBe(2);
  });
});

describe('isBusy', () => {
  it('only treats queued and processing as busy', () => {
    expect(isBusy('queued')).toBe(true);
    expect(isBusy('processing')).toBe(true);
    expect(isBusy('needs_review')).toBe(false);
  });
});

describe('mergeStatuses', () => {
  it('merges live fields without dropping the cover DTO', () => {
    const [merged] = mergeStatuses([cover], [{
      id: 'c1',
      status: 'needs_review',
      renderId: 'r1',
      renderVersion: 2,
      score: 92,
      error: null,
    }]);
    expect(merged).toMatchObject({ id: 'c1', title: 'Hollow Knight', status: 'needs_review', renderVersion: 2, score: 92 });
  });

  it('keeps covers the status poll did not return', () => {
    expect(mergeStatuses([cover], [])).toEqual([cover]);
  });
});
