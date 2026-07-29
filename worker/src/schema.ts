import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

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
  // Bandsintown's numeric artist id; lookups by `id_{id}` are unambiguous where
  // a display-name lookup isn't (see migration 0001).
  bandsintownId: text('bandsintown_id'),
  mbid: text('mbid'),
  imageUrl: text('image_url'),
  genres: text('genres').notNull().default('[]'),
  /** When a client last asked about this artist; drives crawl priority. */
  lastRequestedAt: text('last_requested_at'),
  createdAt: createdAt(),
});

/**
 * The crawl queue: one row per (artist, upstream source). Coverage from
 * Bandsintown is a function of how many artists we ask about, so this is what
 * the Cron Trigger drains (see migration 0003).
 */
export const artistSources = sqliteTable(
  'artist_sources',
  {
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    /** The key that worked upstream — `id_123` or a display name of theirs. */
    sourceKey: text('source_key'),
    /** active | discovered | not_found | disabled */
    state: text('state').notNull().default('active'),
    lastCheckedAt: text('last_checked_at'),
    lastOkAt: text('last_ok_at'),
    failCount: integer('fail_count').notNull().default(0),
    nextCheckAt: text('next_check_at').notNull().default('1970-01-01T00:00:00Z'),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.artistId, t.source] }),
    dueIdx: index('artist_sources_due_idx').on(t.source, t.state, t.nextCheckAt),
  }),
);

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
    /** The venue row representing this physical location (itself, if first). */
    canonicalVenueId: text('canonical_venue_id'),
  },
  (t) => ({
    sourceUnique: unique().on(t.source, t.sourceVenueId),
    latlngIdx: index('venues_latlng_idx').on(t.lat, t.lng),
    canonicalIdx: index('venues_canonical_idx').on(t.canonicalVenueId),
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
    endsAt: text('ends_at'),
    ticketUrl: text('ticket_url'),
    priceFrom: real('price_from'),
    soldOut: integer('sold_out', { mode: 'boolean' }),
    isFree: integer('is_free', { mode: 'boolean' }),
    lineup: text('lineup'), // JSON array of artist names (Bandsintown)
    source: text('source').notNull(),
    sourceEventId: text('source_event_id').notNull(),
    /** JSON map of every upstream that describes this show: {source: id}. */
    sources: text('sources'),
    createdAt: createdAt(),
  },
  (t) => ({
    sourceUnique: unique().on(t.source, t.sourceEventId),
    startsAtIdx: index('events_starts_at_idx').on(t.startsAt),
    artistIdx: index('events_artist_idx').on(t.artistId, t.startsAt),
    dedupeIdx: index('events_dedupe_idx').on(t.venueId, t.artistId, t.startsAt),
  }),
);

/**
 * One row per ingestion pass. The point is being able to answer "when did this
 * source last produce anything?" without inferring it from event rows — a source
 * whose key goes missing keeps returning success and zero (see migration 0006).
 */
export const ingestRuns = sqliteTable(
  'ingest_runs',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    /** crawl | backfill | discover | refresh-artists | refresh-venue */
    kind: text('kind').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    scanned: integer('scanned').notNull().default(0),
    inserted: integer('inserted').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    note: text('note'),
  },
  (t) => ({
    recentIdx: index('ingest_runs_recent_idx').on(t.source, t.startedAt),
  }),
);

export const discoveryLog = sqliteTable('discovery_log', {
  cell: text('cell').primaryKey(),
  fetchedAt: text('fetched_at').notNull(),
});
