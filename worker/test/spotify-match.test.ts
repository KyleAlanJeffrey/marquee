import { describe, expect, it } from 'vitest';

import { artistNameKey, buildNameKeys, pickCatalogueMatches, type CatalogueRow } from '../src/spotify-me';

const row = (over: Partial<CatalogueRow>): CatalogueRow => ({
  id: 'art_x',
  spotifyId: null,
  name: 'Someone',
  upcoming: 0,
  ...over,
});

const keysFor = (pairs: [name: string, spotifyId: string][]) =>
  new Map(pairs.map(([name, sid]) => [artistNameKey(name), sid]));

/**
 * The shapes here are production's, found the day the feature shipped: a
 * listener's whole library read "no dates yet" while D1 held the dates.
 */
describe('pickCatalogueMatches', () => {
  it('lets a same-named row with shows outbid an id match without any (the Gorillaz shape)', () => {
    // Two catalogue rows for one act: the id landed on a stray with 0 events,
    // the bare twin holds the 42-date tour.
    const { matched, backfill } = pickCatalogueMatches(
      [row({ id: 'art_stray', spotifyId: 'sp_gorillaz', upcoming: 0, name: 'Gorillaz' })],
      [
        row({ id: 'art_stray', spotifyId: 'sp_gorillaz', upcoming: 0, name: 'Gorillaz' }),
        row({ id: 'art_real', spotifyId: null, upcoming: 42, name: 'Gorillaz' }),
      ],
      keysFor([['Gorillaz', 'sp_gorillaz']]),
    );
    expect(matched.get('sp_gorillaz')).toEqual({ artistId: 'art_real', upcoming: 42 });
    // The winner had no id, so it earns the write-back.
    expect(backfill).toEqual([{ artistId: 'art_real', spotifyId: 'sp_gorillaz' }]);
  });

  it('reaches a row whose stored id is wrong, via its name (the Parcels shape)', () => {
    // Enrichment wrote an id that isn't the artist's real one: the id match
    // misses entirely, and the old IS NULL filter kept the name match from
    // ever seeing the row. 24 shows read as "no dates yet".
    const { matched, backfill } = pickCatalogueMatches(
      [],
      [row({ id: 'art_parcels', spotifyId: 'sp_wrong', upcoming: 24, name: 'Parcels' })],
      keysFor([['Parcels', 'sp_parcels']]),
    );
    expect(matched.get('sp_parcels')).toEqual({ artistId: 'art_parcels', upcoming: 24 });
    // Never overwrite a stored id from here — the row already has one, wrong
    // or not; that repair is enrichment's to make with better evidence.
    expect(backfill).toEqual([]);
  });

  it('keeps the id match when the evidence is equal', () => {
    const { matched } = pickCatalogueMatches(
      [row({ id: 'art_by_id', spotifyId: 'sp_a', upcoming: 3, name: 'The XX' })],
      [row({ id: 'art_by_name', spotifyId: null, upcoming: 3, name: 'The XX' })],
      keysFor([['The XX', 'sp_a']]),
    );
    // Ties defer to the stronger claim — id equality beats a name.
    expect(matched.get('sp_a')!.artistId).toBe('art_by_id');
  });

  it('settles duplicate same-named rows on the busier one', () => {
    const { matched, backfill } = pickCatalogueMatches(
      [],
      [
        row({ id: 'art_a', upcoming: 21, name: 'The Strokes' }),
        row({ id: 'art_b', upcoming: 31, name: 'The Strokes' }),
      ],
      keysFor([['The Strokes', 'sp_strokes']]),
    );
    expect(matched.get('sp_strokes')!.artistId).toBe('art_b');
    // The outbid candidate must not be written back: it lost.
    expect(backfill).toEqual([{ artistId: 'art_b', spotifyId: 'sp_strokes' }]);
  });

  it('ignores rows whose name answers to no wanted artist', () => {
    const { matched, backfill } = pickCatalogueMatches(
      [],
      [row({ id: 'art_noise', upcoming: 9, name: 'Somebody Else' })],
      keysFor([['Parcels', 'sp_parcels']]),
    );
    expect(matched.size).toBe(0);
    expect(backfill).toEqual([]);
  });

  it('matches names case-insensitively through artistNameKey', () => {
    const { matched } = pickCatalogueMatches(
      [],
      [row({ id: 'art_mt', upcoming: 5, name: 'MOLLY TUTTLE' })],
      keysFor([['Molly Tuttle', 'sp_mt']]),
    );
    expect(matched.get('sp_mt')!.artistId).toBe('art_mt');
  });
});

describe('buildNameKeys', () => {
  it('drops a key two different Spotify artists collide on', () => {
    const keys = buildNameKeys([
      { id: 'sp_one', name: 'CAPO' },
      { id: 'sp_two', name: 'Capo' },
      { id: 'sp_solo', name: 'Parcels' },
    ]);
    // The collision matches nobody — a wrong backfill writes a wrong id into
    // the catalogue, which is worse than two acts with no dates.
    expect(keys.has(artistNameKey('CAPO'))).toBe(false);
    expect(keys.get(artistNameKey('Parcels'))).toBe('sp_solo');
  });

  it('the same artist listed twice is not a collision', () => {
    const keys = buildNameKeys([
      { id: 'sp_one', name: 'Gorillaz' },
      { id: 'sp_one', name: 'GORILLAZ' },
    ]);
    expect(keys.get(artistNameKey('Gorillaz'))).toBe('sp_one');
  });

  it('an ambiguous key produces neither match nor backfill downstream', () => {
    const keys = buildNameKeys([
      { id: 'sp_one', name: 'CAPO' },
      { id: 'sp_two', name: 'Capo' },
    ]);
    const { matched, backfill } = pickCatalogueMatches(
      [],
      [row({ id: 'art_capo', spotifyId: null, upcoming: 12, name: 'Capo' })],
      keys,
    );
    expect(matched.size).toBe(0);
    expect(backfill).toEqual([]);
  });
});
