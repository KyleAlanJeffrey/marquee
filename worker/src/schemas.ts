import { z } from 'zod';

import { EVENTS_BY_IDS_MAX, FOLLOWING_IDS_MAX } from './data';

/** Shared zod schemas for request validation (query params + JSON bodies). */

/** Real coordinates. Unbounded latitude sends `Math.cos` negative in the delta
 *  maths, and the clamp then widens the bounding box to a fifth of the planet. */
const latitude = z.coerce.number().min(-90).max(90);
const longitude = z.coerce.number().min(-180).max(180);
/** Our ids are UUIDs; a length cap keeps an unbounded body off the query planner. */
const entityId = z.string().trim().min(1).max(64);

const artistRef = z.object({
  artistId: z.string().nullish(),
  spotifyId: z.string().nullish(),
  name: z.string().optional(),
  imageUrl: z.string().nullish(),
  genres: z.array(z.string()).optional().default([]),
});

export const nearbyQuery = z.object({
  lat: latitude,
  lng: longitude,
  radius: z.coerce.number().positive().max(1000).optional().default(50),
  limit: z.coerce.number().int().positive().max(400).optional().default(400),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const nearbyVenuesQuery = z.object({
  lat: latitude,
  lng: longitude,
  radius: z.coerce.number().positive().max(1000).optional().default(50),
  limit: z.coerce.number().int().positive().max(50).optional().default(12),
});

/** The saved list a client wants current rows for. */
export const eventIdsBody = z.object({
  ids: z.array(entityId).min(1).max(EVENTS_BY_IDS_MAX),
});

/**
 * The on-device follow lists, asked as a question about those artists and rooms.
 * Either list may be empty (you can follow only venues), but not both. The point
 * fills in distances, and with a radius it also bounds the list.
 */
export const followingBody = z
  .object({
    artistIds: z.array(entityId).max(FOLLOWING_IDS_MAX).optional().default([]),
    // An artist followed from search has only a Spotify id until a show of theirs
    // turns up in our catalog, so both identities have to be askable.
    spotifyIds: z.array(entityId).max(FOLLOWING_IDS_MAX).optional().default([]),
    venueIds: z.array(entityId).max(FOLLOWING_IDS_MAX).optional().default([]),
    lat: latitude.nullish(),
    lng: longitude.nullish(),
    // Only gates when there is a point to measure from.
    radiusMiles: z.coerce.number().positive().max(1000).nullish(),
  })
  .refine((b) => b.artistIds.length + b.spotifyIds.length + b.venueIds.length > 0, {
    message: 'follow at least one artist or venue',
  });

export const pageQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const searchBody = z.object({ query: z.string().trim().min(1) });

export const townsQuery = z.object({
  // Empty is meaningful here: it asks for the busiest towns we know about.
  q: z.string().trim().max(80).optional().default(''),
  limit: z.coerce.number().int().positive().max(50).optional().default(12),
});

export const ensureBody = artistRef.refine((b) => b.spotifyId || b.artistId, {
  message: 'spotifyId or artistId is required',
});

export const discoverBody = z.object({
  lat: z.number(),
  lng: z.number(),
  radius: z.number().positive().max(1000).optional().default(50),
});

export const refreshArtistsBody = z.object({
  artists: z.array(artistRef.extend({ name: z.string().min(1) })).min(1),
});

/*
 * The four on-device lists, as the server will accept them.
 *
 * These mirror `isFollowedArtist`, `isFollowedVenue`, `isSavedShow` and
 * `isAttendance` in `src/lib/*-store.tsx`. Two validators for one shape is a real
 * cost, and it is paid on purpose: the client's exists because a device's
 * `localStorage` can be edited, and this one exists because an HTTP body can be
 * anything at all. Neither can stand in for the other.
 *
 * Every string is capped. The caps are not product rules — they stop one request
 * from writing a megabyte into a row that gets read back on every sign-in.
 */

/** Snapshot text: long enough for a real venue name, short enough to bound a row. */
const snapshotText = z.string().max(300);
/** Absent and null both mean null. Older clients may simply omit a field. */
const nullableText = snapshotText.nullish().transform((v) => v ?? null);
const nullableNumber = z.number().nullish().transform((v) => v ?? null);
/** Epoch millis. Not bounded to "now" — a device with a wrong clock still owns its list. */
const stamp = z.number().int();
/** 1–5 whole stars, or nothing. Matches `isRating` on the client. */
const rating = z
  .number()
  .int()
  .min(1)
  .max(5)
  .nullish()
  .transform((v) => v ?? null);

/** The show snapshot carried by both saved shows and attendances. */
const showSnapshot = {
  eventId: entityId,
  name: snapshotText,
  startsAt: z.string().max(40),
  artistId: nullableText,
  artistName: nullableText,
  artistImageUrl: z.string().max(1000).nullish().transform((v) => v ?? null),
  venueId: nullableText,
  venueName: nullableText,
  venueCity: nullableText,
  venueTimezone: nullableText,
};

const followedArtist = z
  .object({
    artistId: nullableText,
    spotifyId: nullableText,
    name: snapshotText,
    imageUrl: z.string().max(1000).nullish().transform((v) => v ?? null),
    genres: z.array(z.string().max(60)).max(30).optional().default([]),
    followedAt: stamp,
  })
  // The same rule the client enforces: an artist followed from search has only a
  // Spotify id, one from a nearby show has only ours, and an entry with neither
  // can never be matched against anything again.
  .refine((a) => !!a.artistId || !!a.spotifyId, {
    message: 'artistId or spotifyId is required',
  });

const followedVenue = z.object({
  venueId: entityId,
  name: snapshotText,
  city: nullableText,
  region: nullableText,
  lat: nullableNumber,
  lng: nullableNumber,
  followedAt: stamp,
});

const savedShow = z.object({ ...showSnapshot, priceFrom: nullableNumber, savedAt: stamp });

const attendance = z.object({
  ...showSnapshot,
  loggedAt: stamp,
  rating,
  venueRating: rating,
  note: z.string().max(2000).nullish().transform((v) => v ?? null),
});

/**
 * How many entries one list may hold.
 *
 * A ceiling rather than a target: the busiest plausible user is a few hundred
 * follows and a lifetime of gigs, and anything past this is a loop rather than a
 * person. Attendances get more room because a log only grows.
 */
export const LIST_MAX = 1000;
export const ATTENDANCE_MAX = 2000;

/**
 * A whole-list push. Every key optional, so a client can send one list or all four.
 *
 * Whole-list rather than per-item because it makes deletion work without
 * tombstones: what the client sends *is* the list, so an entry it dropped is gone.
 * The cost is that two devices editing at once means the later writer wins the
 * whole list, which is honest for one person with one phone and is written down in
 * todo.md as the thing to fix before it isn't.
 */
export const listsBody = z
  .object({
    follows: z.array(followedArtist).max(LIST_MAX).optional(),
    venues: z.array(followedVenue).max(LIST_MAX).optional(),
    saved: z.array(savedShow).max(LIST_MAX).optional(),
    attendances: z.array(attendance).max(ATTENDANCE_MAX).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'send at least one list' });

/**
 * The two preferences that live on the account.
 *
 * Both optional so a client can set one without restating the other, and the radius
 * is checked against the same options the UI offers rather than any positive number —
 * a value the picker cannot produce is a bug somewhere, not a preference.
 */
/**
 * A public review as the server will accept it. Both ratings and the body are
 * optional, but not all at once — an entry with none of them says nothing, and
 * "I was there" is what the private log is for. The body cap bounds the row,
 * not the prose: nobody has ever needed a five-thousand-character verdict.
 */
export const reviewBody = z
  .object({
    rating: z.number().int().min(1).max(5).nullish(),
    venueRating: z.number().int().min(1).max(5).nullish(),
    body: z.string().trim().max(4000).nullish(),
  })
  .refine((v) => v.rating != null || v.venueRating != null || (v.body ?? '').length > 0, {
    message: 'a review needs a rating or some words',
  });

/** Going or interested — the only two answers an upcoming show asks for. */
export const rsvpBody = z.object({
  status: z.enum(['going', 'interested']),
});

/** A report: what's wrong, in the reporter's words. Required — an unexplained
 *  report can't be triaged, only counted. */
export const reportBody = z.object({
  reason: z.string().trim().min(3).max(500),
});

/** Resolving a report: hide the content, or keep it and close the report. */
export const reportResolveBody = z.object({
  action: z.enum(['hide', 'keep']),
});

export const prefsBody = z
  .object({
    radiusMiles: z.number().int().min(1).max(1000).optional(),
    remindersEnabled: z.boolean().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'send at least one preference' });
