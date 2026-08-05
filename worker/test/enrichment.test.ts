import { describe, expect, it } from 'vitest';

import { pickDeezerArtist, shouldRecheckEnrichment } from '../src/sources';

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

/**
 * Deezer's search index is littered with empty duplicate artist pages that
 * outrank the real one. Every case below is a real response shape measured
 * live 2026-08-05.
 */
describe('pickDeezerArtist', () => {
  it('picks the real page over an impostor that Deezer ranks first', () => {
    // Searching "Kesha": a blank 12-fan duplicate leads; the real page has 4.2M.
    const picked = pickDeezerArtist('Kesha', [
      { id: 224899105, name: 'Kesha', nb_fan: 12 },
      { id: 266523722, name: 'Ke$ha', nb_fan: 504 },
      { id: 12928, name: 'Kesha', nb_fan: 4176339 },
    ]);
    expect(picked.id).toBe(12928);
  });

  it('matches names case-insensitively', () => {
    // "IVE" is stored as "Ive" on the impostor and "IVE" on the real page.
    const picked = pickDeezerArtist('IVE', [
      { id: 1, name: 'Ive', nb_fan: 7 },
      { id: 2, name: "I've", nb_fan: 42 },
      { id: 3, name: 'IVE', nb_fan: 264979 },
    ]);
    expect(picked.id).toBe(3);
  });

  it('falls back to the first hit when nothing matches exactly', () => {
    const picked = pickDeezerArtist('Sour Widows', [
      { id: 9, name: 'Sour Widows Tribute', nb_fan: 3 },
    ]);
    expect(picked.id).toBe(9);
  });

  it('returns null for an empty or malformed answer', () => {
    expect(pickDeezerArtist('Anyone', [])).toBeNull();
    expect(pickDeezerArtist('Anyone', undefined)).toBeNull();
    expect(pickDeezerArtist('Anyone', [{ name: 'No Id' }])).toBeNull();
  });

  it('prefers a match with a fan count over one without', () => {
    const picked = pickDeezerArtist('Toto', [
      { id: 1, name: 'Toto' },
      { id: 2, name: 'Toto', nb_fan: 974364 },
    ]);
    expect(picked.id).toBe(2);
  });
});
