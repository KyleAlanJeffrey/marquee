import { describe, expect, it } from 'vitest';

import { sanitizeInputs, type EventInput } from '../src/data';

const NOW = Date.parse('2026-07-28T12:00:00Z');
const at = (startsAt: string, artistId = 'a1'): EventInput => ({
  source: 'bandsintown',
  source_event_id: `${artistId}-${startsAt}`,
  name: 'A show',
  starts_at: startsAt,
  ticket_url: null,
  price_from: null,
  artist_id: artistId,
  venue: null,
});

const days = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('sanitizeInputs', () => {
  it('keeps upcoming shows', () => {
    expect(sanitizeInputs([at(days(1)), at(days(200))], NOW)).toHaveLength(2);
  });

  it('keeps shows already past, because they are the log', () => {
    // This used to assert the opposite. A show becomes worth keeping the moment it
    // happens — you can only log a gig we still hold a row for — and the sources
    // stop listing it once it's over, so anything dropped here is unrecoverable.
    expect(sanitizeInputs([at(days(-0.5))], NOW)).toHaveLength(1);
    expect(sanitizeInputs([at(days(-7))], NOW)).toHaveLength(1);
    expect(sanitizeInputs([at(days(-400))], NOW)).toHaveLength(1);
  });

  it('drops dates far enough out, either way, to be a parsing error', () => {
    expect(sanitizeInputs([at('2199-01-01T20:00:00Z')], NOW)).toHaveLength(0);
    expect(sanitizeInputs([at(days(365))], NOW)).toHaveLength(1);
    // The floor is what still catches a mis-parsed year: epoch zero, and a date
    // whose year came through as "0202", are errors whichever way they point.
    expect(sanitizeInputs([at('1970-01-01T00:00:00Z')], NOW)).toHaveLength(0);
    expect(sanitizeInputs([at('0202-05-01T20:00:00Z')], NOW)).toHaveLength(0);
    expect(sanitizeInputs([at(days(-365))], NOW)).toHaveLength(1);
  });

  it('drops an unparseable date rather than storing NaN', () => {
    expect(sanitizeInputs([at('not-a-date')], NOW)).toHaveLength(0);
  });

  it('caps one artist per pass, so a malformed feed cannot flood the table', () => {
    const many = Array.from({ length: 500 }, (_, i) => at(days(1 + i / 100)));
    expect(sanitizeInputs(many, NOW)).toHaveLength(200);
  });

  it('counts the cap per artist, not per batch', () => {
    const inputs = [
      ...Array.from({ length: 250 }, (_, i) => at(days(1 + i / 100), 'a1')),
      ...Array.from({ length: 10 }, (_, i) => at(days(1 + i / 100), 'a2')),
    ];
    const kept = sanitizeInputs(inputs, NOW);
    expect(kept.filter((i) => i.artist_id === 'a1')).toHaveLength(200);
    expect(kept.filter((i) => i.artist_id === 'a2')).toHaveLength(10);
  });
});

/**
 * The loosened bounds a history backfill passes.
 *
 * Tested because the defaults are correct and the overrides are correct, and the
 * failure mode of confusing them is silent: widen the defaults and mis-parsed years
 * get into the live crawl; forget the overrides and a decade of somebody's gigs is
 * dropped on the floor with a `console.warn` nobody reads.
 */
describe('sanitizeInputs limits', () => {
  const years = (n: number) => new Date(NOW - n * 365 * 86_400_000).toISOString();

  it('drops a 2014 show by default, which is why the backfill needs an override', () => {
    // The live crawl has no way to tell a real old date from a mis-parsed year, so
    // its window stays tight. This is the exact case that made the override necessary:
    // Bandsintown returns history back to 2014 and every row of it would be discarded.
    expect(sanitizeInputs([at(years(12))], NOW)).toHaveLength(0);
    expect(sanitizeInputs([at(years(12))], NOW, { maxYearsBehind: 20 })).toHaveLength(1);
  });

  it('still rejects an impossible year however wide the window', () => {
    // The floor's real job is catching an epoch-zero or "0202" parse, and widening it
    // for history must not give that up.
    for (const limits of [{}, { maxYearsBehind: 20 }]) {
      expect(sanitizeInputs([at('1970-01-01T00:00:00Z')], NOW, limits)).toHaveLength(0);
      expect(sanitizeInputs([at('0202-05-01T20:00:00Z')], NOW, limits)).toHaveLength(0);
    }
  });

  it('does not let the wider window change the future horizon', () => {
    // Asking for history says nothing about what is plausible ahead of us; a listing
    // in 2199 is still a data error.
    expect(sanitizeInputs([at('2199-01-01T20:00:00Z')], NOW, { maxYearsBehind: 20 })).toHaveLength(0);
  });

  it('raises the per-artist cap without changing the default', () => {
    // Measured: one artist in our own catalogue has 308 past shows. Keeping 200 of
    // them would leave a log with holes that nothing would ever fill.
    const many = Array.from({ length: 308 }, (_, i) => at(days(-i - 1)));
    expect(sanitizeInputs(many, NOW, { maxYearsBehind: 20 })).toHaveLength(200);
    expect(sanitizeInputs(many, NOW, { maxYearsBehind: 20, maxEventsPerArtist: 500 })).toHaveLength(308);
  });

  it('counts the cap per artist, not per call', () => {
    const mine = Array.from({ length: 30 }, (_, i) => at(days(-i - 1), 'a1'));
    const theirs = Array.from({ length: 30 }, (_, i) => at(days(-i - 1), 'a2'));
    expect(sanitizeInputs([...mine, ...theirs], NOW, { maxEventsPerArtist: 25 })).toHaveLength(50);
  });
});
