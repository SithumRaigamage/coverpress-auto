import { describe, expect, it } from 'vitest';
import { boardColumn, canRetry, compact, fitTone, initials, primaryPlatform, runProgress } from './status';

describe('fitTone', () => {
  it('uses the design thresholds', () => {
    expect(fitTone(80)).toBe('success');
    expect(fitTone(79)).toBe('warning');
    expect(fitTone(60)).toBe('warning');
    expect(fitTone(59)).toBe('danger');
  });
});

describe('boardColumn', () => {
  it('maps every status to one of five columns', () => {
    expect(boardColumn('queued')).toBe('queued');
    expect(boardColumn('processing')).toBe('building');
    expect(boardColumn('needs_review')).toBe('review');
    expect(boardColumn('auto_approved')).toBe('approved');
    expect(boardColumn('approved')).toBe('approved');
    expect(boardColumn('failed')).toBe('failed');
    expect(boardColumn('rejected')).toBe('failed');
  });
  it('only offers /retry where the server accepts it', () => {
    expect(canRetry('needs_review')).toBe(true);
    expect(canRetry('approved')).toBe(false);
  });
});

describe('runProgress', () => {
  it('counts a running step as half', () => {
    const steps = [{ state: 'done' as const }, { state: 'running' as const }, { state: 'pending' as const }, { state: 'pending' as const }];
    expect(runProgress(steps)).toBeCloseTo(1.5 / 4);
    expect(runProgress([])).toBe(0);
  });
});

describe('formatting', () => {
  it('picks PS5 when RAWG lists it, unless filtered', () => {
    expect(primaryPlatform(['PlayStation 4', 'PlayStation 5'], '')).toBe('PS5');
    expect(primaryPlatform(['PlayStation 4'], '')).toBe('PS4');
    expect(primaryPlatform(['PlayStation 5'], 'PS4')).toBe('PS4');
  });
  it('shortens counts and derives initials', () => {
    expect(compact(20000)).toBe('20k');
    expect(compact(1250)).toBe('1.3k');
    expect(compact(12)).toBe('12');
    expect(initials('local@coverpress.local')).toBe('LO');
    expect(initials(undefined)).toBe('CP');
  });
});
