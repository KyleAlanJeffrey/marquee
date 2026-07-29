import { describe, expect, it } from 'vitest';

import {
  backoffHours,
  frontierNames,
  lookupKeys,
  nextCheckAt,
  NOT_FOUND_HOURS,
  REQUEST_INTEREST_HOURS,
  TIER_HOURS,
  tierFor,
} from '../src/crawl';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

describe('tiers', () => {
  it('checks an artist someone is looking at most often', () => {
    expect(tierFor({ lastRequestedAt: hoursAgo(2) }, NOW)).toBe('hot');
    expect(tierFor({ lastRequestedAt: hoursAgo(REQUEST_INTEREST_HOURS + 1) }, NOW)).not.toBe('hot');
  });

  it('checks a touring artist daily and a dormant one weekly', () => {
    expect(tierFor({ hasUpcoming: true }, NOW)).toBe('warm');
    expect(tierFor({ hasUpcoming: false }, NOW)).toBe('cold');
    expect(TIER_HOURS.warm).toBeLessThan(TIER_HOURS.cold);
  });

  it('puts unconfirmed lineup names last, whatever else is true of them', () => {
    expect(tierFor({ state: 'discovered', lastRequestedAt: hoursAgo(1), hasUpcoming: true }, NOW)).toBe('frontier');
    expect(TIER_HOURS.frontier).toBeGreaterThan(TIER_HOURS.cold);
  });

  it('ignores an unparseable request timestamp instead of treating it as now', () => {
    expect(tierFor({ lastRequestedAt: 'not a date' }, NOW)).toBe('cold');
    expect(tierFor({ lastRequestedAt: null }, NOW)).toBe('cold');
  });
});

describe('rescheduling', () => {
  it('backs off exponentially and stops at a week', () => {
    expect([1, 2, 3, 4].map(backoffHours)).toEqual([1, 2, 4, 8]);
    expect(backoffHours(20)).toBe(24 * 7);
    // A first failure must still wait: a zero here would spin on a broken artist.
    expect(backoffHours(0)).toBe(1);
  });

  it('produces an ISO timestamp in the future, in the stored format', () => {
    const at = nextCheckAt(TIER_HOURS.warm, NOW);
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(at)).toBeGreaterThan(NOW + 23 * 3_600_000);
  });

  it('sleeps on a not-found rather than giving up on the artist', () => {
    // A band with no dates yet should still be looked at again eventually.
    expect(NOT_FOUND_HOURS).toBeGreaterThan(TIER_HOURS.cold);
    expect(NOT_FOUND_HOURS).toBeLessThan(24 * 90);
  });
});

describe('lookupKeys', () => {
  it('prefers the numeric id, which is the only unambiguous key', () => {
    const keys = lookupKeys({ name: 'Wednesday', bandsintownId: '15495936' });
    expect(keys[0]).toBe('id_15495936');
  });

  it('falls back to their spelling, then ours, then drops a leading "The"', () => {
    const keys = lookupKeys({ name: 'The Beths', bandsintownName: 'the Beths' });
    expect(keys).toContain('the Beths');
    expect(keys).toContain('The Beths');
    expect(keys).toContain('Beths');
  });

  it('reuses whatever worked last time', () => {
    expect(lookupKeys({ name: 'MJ Lenderman', sourceKey: 'MJ Lenderman and the Wind' })[0]).toBe(
      'MJ Lenderman and the Wind',
    );
  });

  it('never repeats a key — each one costs an upstream request', () => {
    const keys = lookupKeys({ name: 'Wednesday', bandsintownName: 'Wednesday', sourceKey: 'Wednesday' });
    expect(keys).toEqual(['Wednesday']);
  });
});

describe('frontierNames', () => {
  it('returns the support acts and not the headliner', () => {
    expect(frontierNames(['Wednesday', 'Hotline TNT', 'Winona Forever'], 'wednesday')).toEqual([
      'Hotline TNT',
      'Winona Forever',
    ]);
  });

  it('drops duplicates, junk and anything that is not a name', () => {
    expect(frontierNames(['A', '', '  ', 'Hotline TNT', 'hotline tnt', 42, null], 'Wednesday')).toEqual([
      'Hotline TNT',
    ]);
    expect(frontierNames(['x'.repeat(200)], 'Wednesday')).toEqual([]);
  });

  it('survives a missing or malformed lineup', () => {
    expect(frontierNames(null, 'Wednesday')).toEqual([]);
    expect(frontierNames('Wednesday, Hotline TNT', 'Wednesday')).toEqual([]);
  });
});
