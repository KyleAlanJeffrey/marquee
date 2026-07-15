import { z } from 'zod';

/** Shared zod schemas for request validation (query params + JSON bodies). */

const artistRef = z.object({
  artistId: z.string().nullish(),
  spotifyId: z.string().nullish(),
  name: z.string().optional(),
  imageUrl: z.string().nullish(),
  genres: z.array(z.string()).optional().default([]),
});

export const nearbyQuery = z.object({
  lat: z.coerce.number(),
  lng: z.coerce.number(),
  radius: z.coerce.number().positive().max(1000).optional().default(50),
  limit: z.coerce.number().int().positive().max(400).optional().default(400),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const pageQuery = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const searchBody = z.object({ query: z.string().trim().min(1) });

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
