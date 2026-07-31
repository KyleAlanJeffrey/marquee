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
  /**
   * When this artist's *past* shows were last fetched. Null means never asked,
   * which is different from having no history — see migration 0011. History does
   * not change, so unlike the upcoming crawl this is asked once.
   */
  pastEventsFetchedAt: text('past_events_fetched_at'),
  createdAt: createdAt(),
});
// No index block for `artists_history_pending_idx`: it is partial
// (`where past_events_fetched_at is null`), which Drizzle can't express — same as
// `artists_name_folded_idx`.

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
    /** Wikipedia extract for the room, CC BY-SA, shown with `descriptionUrl`. */
    description: text('description'),
    descriptionUrl: text('description_url'),
    /** The article's lead photograph. Free-licensed, so `photoCredit` and
     *  `photoLicense` must render with it — see migration 0008. */
    photoUrl: text('photo_url'),
    photoCredit: text('photo_credit'),
    photoLicense: text('photo_license'),
    photoLicenseUrl: text('photo_license_url'),
    /** When we last *asked*, not when we last found something. */
    enrichmentCheckedAt: text('enrichment_checked_at'),
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

/**
 * When each listing page was last announced to IndexNow — see migration 0007 and
 * `submitFresh`. Only `/` and the city hubs are recorded, so the table is bounded
 * by the number of towns with shows and a repeat submission updates in place.
 */
export const indexnowLog = sqliteTable(
  'indexnow_log',
  {
    url: text('url').primaryKey(),
    submittedAt: text('submitted_at').notNull(),
  },
  (t) => ({
    submittedIdx: index('indexnow_log_submitted_idx').on(t.submittedAt),
  }),
);

/**
 * A local mirror of the identity Clerk owns — see migration 0009.
 *
 * Clerk is authoritative for all of it; this table exists because attendances and
 * reviews need a foreign key, and D1 cannot join against an API. The profile
 * columns are denormalised so rendering somebody else's review doesn't cost a
 * round trip per author.
 */
export const users = sqliteTable('users', {
  /** The Clerk user id (`user_2abc…`), not a uuid of ours. */
  id: text('id').primaryKey(),
  handle: text('handle'),
  displayName: text('display_name'),
  avatarUrl: text('avatar_url'),
  createdAt: text('created_at').notNull(),
  /** When this mirror was last refreshed, so a stale name has a known age. */
  syncedAt: text('synced_at').notNull(),
  /** Set when Clerk says the account is gone; the row stays, see the migration. */
  deletedAt: text('deleted_at'),
  /**
   * Preferences, on the account because nothing lives on the device any more.
   * Null means never chosen, which is different from zero — the client applies its
   * own defaults, so a new account behaves like a new install.
   */
  radiusMiles: integer('radius_miles'),
  /** SQLite has no boolean: 0 or 1, null for never asked. */
  remindersEnabled: integer('reminders_enabled'),
});
// No index block: the one handles have is `users_handle_idx`, partial and on
// `lower(handle)`, which Drizzle can't express — same as `artists_name_folded_idx`.
// Declaring a second, plain index here would mean the schema described an index
// the database has never had, and handle lookups are case-folded anyway.

/**
 * The person graph: who follows whom, one direction per row (see migration 0013).
 * A real relation rather than a `user_lists` document because it is read from
 * both ends — your following list is yours, but your follower count is theirs.
 */
export const personFollows = sqliteTable(
  'person_follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id),
    followeeId: text('followee_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index('person_follows_followee_idx').on(t.followeeId)],
);

/**
 * Public reviews — a publication, not the private log; see migration 0014 for
 * why they are different tables and what 'hidden' means.
 */
export const reviews = sqliteTable(
  'reviews',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    eventId: text('event_id').notNull(),
    artistId: text('artist_id'),
    venueId: text('venue_id'),
    rating: integer('rating'),
    venueRating: integer('venue_rating'),
    body: text('body'),
    visibility: text('visibility').notNull().default('public'),
    createdAt: text('created_at').notNull(),
    editedAt: text('edited_at'),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    unique().on(t.userId, t.eventId),
    index('reviews_event_idx').on(t.eventId),
    index('reviews_artist_idx').on(t.artistId),
    index('reviews_venue_idx').on(t.venueId),
    index('reviews_user_idx').on(t.userId),
  ],
);

/** Reports against public content — guideline 1.2's report path. */
export const reports = sqliteTable(
  'reports',
  {
    id: text('id').primaryKey(),
    reporterId: text('reporter_id')
      .notNull()
      .references(() => users.id),
    targetKind: text('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason').notNull(),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
    resolution: text('resolution'),
  },
  (t) => [index('reports_open_idx').on(t.resolvedAt), index('reports_target_idx').on(t.targetKind, t.targetId)],
);

/** Going/interested on upcoming shows — see migration 0015 for why it's a relation. */
export const eventRsvps = sqliteTable(
  'event_rsvps',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    eventId: text('event_id').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] }), index('event_rsvps_event_idx').on(t.eventId)],
);

/** Curated lists (phase E) — hard-delete until reactions hang off them; see 0016. */
export const lists = sqliteTable(
  'lists',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    description: text('description'),
    visibility: text('visibility').notNull().default('public'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('lists_user_idx').on(t.userId)],
);

export const listItems = sqliteTable(
  'list_items',
  {
    listId: text('list_id')
      .notNull()
      .references(() => lists.id),
    refKind: text('ref_kind').notNull(),
    refId: text('ref_id').notNull(),
    position: integer('position').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.refKind, t.refId] })],
);

/** Blocks — one direction per row; reads hide content in both directions. */
export const userBlocks = sqliteTable(
  'user_blocks',
  {
    blockerId: text('blocker_id')
      .notNull()
      .references(() => users.id),
    blockedId: text('blocked_id')
      .notNull()
      .references(() => users.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('user_blocks_blocked_idx').on(t.blockedId)],
);

/**
 * The four lists a person owns — follows, followed venues, saved shows, the
 * attendance log — one row per list, each holding the client's own JSON array.
 *
 * A document rather than four relational tables because the job is portability and
 * not querying; see `0010_user_lists.sql` for the reasoning and for when to stop
 * doing it this way.
 */
export const userLists = sqliteTable(
  'user_lists',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    /** One of `follows` | `venues` | `saved` | `attendances`, checked in SQL. */
    kind: text('kind').notNull(),
    /** A JSON array, validated on the way in and again on the way out. */
    payload: text('payload').notNull(),
    /** Epoch millis, matching the stamps inside the payload rather than ISO text. */
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);
