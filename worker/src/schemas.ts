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
