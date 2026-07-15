import { sql } from 'drizzle-orm';
import { index, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

// Drizzle table definitions for the Marquee D1 database. These mirror
// `worker/schema.sql` (which is still the applied DDL + dev seed — keep the two
// in sync when columns change). Column names map camelCase -> snake_case.

const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`);

export const artists = sqliteTable('artists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  spotifyId: text('spotify_id').unique(),
  ticketmasterId: text('ticketmaster_id').unique(),
  bandsintownName: text('bandsintown_name'),
  imageUrl: text('image_url'),
  genres: text('genres').notNull().default('[]'),
  createdAt: createdAt(),
});

export const venues = sqliteTable(
  'venues',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    sourceVenueId: text('source_venue_id').notNull(),
    name: text('name').notNull(),
    city: text('city'),
    region: text('region'),
    country: text('country'),
    lat: real('lat'),
    lng: real('lng'),
  },
  (t) => ({
    sourceUnique: unique().on(t.source, t.sourceVenueId),
    latlngIdx: index('venues_latlng_idx').on(t.lat, t.lng),
  }),
);

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    venueId: text('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    startsAt: text('starts_at').notNull(), // ISO 8601 UTC
    ticketUrl: text('ticket_url'),
    priceFrom: real('price_from'),
    source: text('source').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    sourceUnique: unique().on(t.source, t.sourceEventId),
    startsAtIdx: index('events_starts_at_idx').on(t.startsAt),
    artistIdx: index('events_artist_idx').on(t.artistId, t.startsAt),
  }),
);

export const discoveryLog = sqliteTable('discovery_log', {
  cell: text('cell').primaryKey(),
  fetchedAt: text('fetched_at').notNull(),
});
