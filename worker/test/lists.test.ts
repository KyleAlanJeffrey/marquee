import { describe, expect, it } from 'vitest';

import { ATTENDANCE_MAX, LIST_MAX, listsBody } from '../src/schemas';

/**
 * The wire contract for the four on-device lists.
 *
 * Worth testing on its own because this schema is the *second* validator for these
 * shapes — the client has `isFollowedArtist` and friends — and two validators drift
 * apart silently. Anything asserted here should hold on both sides.
 */

const artist = (over: Record<string, unknown> = {}) => ({
  artistId: 'a1',
  spotifyId: null,
  name: 'Gin Blossoms',
  imageUrl: null,
  genres: [],
  followedAt: 1_700_000_000_000,
  ...over,
});

const show = (over: Record<string, unknown> = {}) => ({
  eventId: 'e1',
  name: 'Gin Blossoms',
  startsAt: '2026-08-01T02:00:00.000Z',
  artistId: null,
  artistName: null,
  artistImageUrl: null,
  venueId: null,
  venueName: null,
  venueCity: null,
  venueTimezone: null,
  ...over,
});

describe('listsBody', () => {
  it('takes one list without demanding the rest', () => {
    const parsed = listsBody.parse({ follows: [artist()] });
    expect(parsed.follows).toHaveLength(1);
    // Absent means "don't touch that list", not "empty it" — the route only writes
    // the keys it was given, so undefined has to survive parsing.
    expect(parsed.venues).toBeUndefined();
    expect(parsed.saved).toBeUndefined();
    expect(parsed.attendances).toBeUndefined();
  });

  it('rejects a body that names no list at all', () => {
    // An empty push is always a bug in the caller. Accepting it would write nothing
    // and answer 200, which reads as a successful sync.
    expect(listsBody.safeParse({}).success).toBe(false);
  });

  it('accepts an empty list, which is how the last entry gets deleted', () => {
    const parsed = listsBody.parse({ follows: [] });
    expect(parsed.follows).toEqual([]);
  });

  describe('followed artists', () => {
    it('needs one of the two identities, and takes either', () => {
      expect(listsBody.safeParse({ follows: [artist({ artistId: 'a1', spotifyId: null })] }).success).toBe(true);
      expect(listsBody.safeParse({ follows: [artist({ artistId: null, spotifyId: 's1' })] }).success).toBe(true);
      // The same rule as `isFollowedArtist`: with neither id this entry can never be
      // matched against an event again, so it is not storable.
      expect(listsBody.safeParse({ follows: [artist({ artistId: null, spotifyId: null })] }).success).toBe(false);
    });

    it('treats a missing nullable field as null rather than rejecting it', () => {
      // Forgiving on purpose: an older client that predates a field should still be
      // able to sync, and the client's own validator reads absent and null alike.
      const parsed = listsBody.parse({ follows: [{ artistId: 'a1', name: 'X', followedAt: 1 }] });
      expect(parsed.follows?.[0]).toMatchObject({ spotifyId: null, imageUrl: null, genres: [] });
    });

    it('rejects a non-integer timestamp', () => {
      expect(listsBody.safeParse({ follows: [artist({ followedAt: 1.5 })] }).success).toBe(false);
    });
  });

  describe('attendances', () => {
    it('takes a rated night, an unrated one, and a note', () => {
      const parsed = listsBody.parse({
        attendances: [
          show({ loggedAt: 1, rating: 5, venueRating: 3, note: 'ears still ringing' }),
          show({ eventId: 'e2', loggedAt: 2 }),
        ],
      });
      expect(parsed.attendances?.[0]).toMatchObject({ rating: 5, venueRating: 3, note: 'ears still ringing' });
      // "I was there" with no verdict offered is the common case, and both ratings
      // plus the note default to null rather than to a number nobody chose.
      expect(parsed.attendances?.[1]).toMatchObject({ rating: null, venueRating: null, note: null });
    });

    it('holds the star range the client clamps to', () => {
      for (const rating of [1, 2, 3, 4, 5, null]) {
        expect(listsBody.safeParse({ attendances: [show({ loggedAt: 1, rating })] }).success).toBe(true);
      }
      for (const rating of [0, 6, -1, 2.5]) {
        expect(listsBody.safeParse({ attendances: [show({ loggedAt: 1, rating })] }).success).toBe(false);
      }
    });

    it('caps the note instead of storing an essay', () => {
      expect(listsBody.safeParse({ attendances: [show({ loggedAt: 1, note: 'x'.repeat(2000) })] }).success).toBe(true);
      expect(listsBody.safeParse({ attendances: [show({ loggedAt: 1, note: 'x'.repeat(2001) })] }).success).toBe(false);
    });
  });

  describe('saved shows and venues', () => {
    it('requires an event id that is not the empty string', () => {
      expect(listsBody.safeParse({ saved: [show({ savedAt: 1 })] }).success).toBe(true);
      expect(listsBody.safeParse({ saved: [show({ eventId: '', savedAt: 1 })] }).success).toBe(false);
    });

    it('keeps a venue with no coordinates', () => {
      // Plenty of rooms have a name and a town and nothing else; the follow is still
      // worth storing, and the map just doesn't draw a pin.
      const parsed = listsBody.parse({
        venues: [{ venueId: 'v1', name: 'The Showbox', city: 'Seattle', region: 'WA', followedAt: 1 }],
      });
      expect(parsed.venues?.[0]).toMatchObject({ lat: null, lng: null });
    });
  });

  describe('size ceilings', () => {
    it('takes a list at the cap and refuses one past it', () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => artist({ artistId: `a${i}` }));
      expect(listsBody.safeParse({ follows: many(LIST_MAX) }).success).toBe(true);
      expect(listsBody.safeParse({ follows: many(LIST_MAX + 1) }).success).toBe(false);
    });

    it('gives the attendance log more room than the others, because it only grows', () => {
      const nights = (n: number) => Array.from({ length: n }, (_, i) => show({ eventId: `e${i}`, loggedAt: i }));
      expect(ATTENDANCE_MAX).toBeGreaterThan(LIST_MAX);
      expect(listsBody.safeParse({ attendances: nights(ATTENDANCE_MAX) }).success).toBe(true);
      expect(listsBody.safeParse({ attendances: nights(ATTENDANCE_MAX + 1) }).success).toBe(false);
    });
  });
});
