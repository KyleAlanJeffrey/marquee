import { describe, expect, it } from 'vitest';

import { shouldRecheckEnrichment } from '../src/sources';

/**
 * When a venue's Wikipedia enrichment gets re-asked. Written once and never
 * revisited meant a room that had no article the day we asked could never gain
 * one — and articles get written.
 */
describe('shouldRecheckEnrichment', () => {
  const NOW = Date.parse('2026-07-31T12:00:00Z');
  const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

  it('always checks a venue never asked about', () => {
    expect(shouldRecheckEnrichment(null, null, NOW)).toBe(true);
  });

  it('re-asks an empty answer after a month, not on every view', () => {
    expect(shouldRecheckEnrichment(daysAgo(1), null, NOW)).toBe(false);
    expect(shouldRecheckEnrichment(daysAgo(29), null, NOW)).toBe(false);
    expect(shouldRecheckEnrichment(daysAgo(31), null, NOW)).toBe(true);
  });

  it('leaves a found description alone for much longer', () => {
    // An article that exists mostly gets edited, not deleted; the long window is
    // for renames and corrections, not freshness.
    expect(shouldRecheckEnrichment(daysAgo(31), 'A storied room.', NOW)).toBe(false);
    expect(shouldRecheckEnrichment(daysAgo(179), 'A storied room.', NOW)).toBe(false);
    expect(shouldRecheckEnrichment(daysAgo(181), 'A storied room.', NOW)).toBe(true);
  });

  it('treats an unparseable stamp as never checked', () => {
    expect(shouldRecheckEnrichment('not-a-date', null, NOW)).toBe(true);
  });
});
