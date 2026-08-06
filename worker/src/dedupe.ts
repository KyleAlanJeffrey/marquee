/**
 * Cross-source identity for venues and shows.
 *
 * Two sources describing the same night out don't agree on much: Ticketmaster
 * says "Moody Center ATX" and Bandsintown says "Moody Center"; Ticketmaster
 * timestamps are UTC and Bandsintown's are venue-local with no offset. What they
 * do agree on is *where* — coordinates match to within a couple of hundred
 * metres — so location is the primary signal here and names are a tiebreaker.
 */

export const VENUE_MATCH_METERS = 300;
/** Same building, whatever it's called — good enough on its own. */
export const VENUE_SAME_SPOT_METERS = 50;
/**
 * Ticketmaster often gives a city centroid rather than the door: measured pairs
 * of the same room came in 821m ("Franklin Music Hall"), 1.4km ("Royal Oak Music
 * Theatre"), and 6.6km ("The Eastern-GA" vs "The Eastern") apart. Past a few
 * hundred metres the name has to carry the match, and it has to be the same town.
 */
export const VENUE_SAME_NAME_METERS = 12_000;
/**
 * How far apart two listings of one show can be. Bandsintown times are local and
 * only approximately converted (see `guessUtcOffsetHours`), so this has to be
 * hours, not minutes — but it must stay well under 24h or an artist's two-night
 * run at one venue would collapse into a single show. Missing a duplicate is the
 * cheaper mistake.
 */
export const SHOW_MATCH_HOURS = 6;
/**
 * The window when one side's time is a placeholder. A time-unknown listing is
 * pinned to noon at the venue, so everything on the same local day — midnight
 * to midnight — sits within exactly twelve hours of it in the same zone.
 * Thirteen looked like harmless DST slack but isn't: it also reaches a real
 * 11pm show on the *previous* night, and merging a late club show into the
 * next day's TBD listing is worse than what the slack buys. The fall-back
 * transition can push a post-11pm same-day show just outside twelve; missing
 * that duplicate one night a year is the cheaper mistake.
 */
export const TBD_SHOW_MATCH_HOURS = 12;

const EARTH_RADIUS_M = 6_371_000;

export function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Words that carry no identity — every other venue in town is also a "music hall". */
const STOPWORDS = new Set([
  'the', 'at', 'of', 'and', 'a', 'an', 'la', 'le', 'el',
  'theatre', 'theater', 'hall', 'music', 'club', 'live', 'venue', 'room', 'bar',
  'center', 'centre', 'arena', 'stadium', 'amphitheatre', 'amphitheater', 'pavilion',
  'lounge', 'stage', 'house', 'presented', 'by',
]);

/**
 * Bandsintown's `venue.name` sometimes carries the *tour* instead of the room, so
 * the table holds rows called "Brunette World Tour" and "BILMURI presents: The
 * KINDA HARD Tour" — 653 of them, one per city the tour visits.
 *
 * The coordinates on those rows are still the real ones: the junk-named row usually
 * sits exactly on top of the proper venue ("This Might Be Useful" Tour on Paper
 * Tiger, JOJI: SOLARIS TOUR on 3Arena). So the row is worth keeping for its
 * location and only its name is worthless — which is why this makes the name carry
 * no identity rather than dropping the venue. A row with no name to vouch for it
 * still merges into the real venue at the same coordinates, which is where its
 * shows belong; discarding it instead would strand the show with no location at
 * all and drop it out of "near me" entirely.
 *
 * Festival names ("Aftershock 2026", "Austin City Limits Music Festival 2026") are
 * deliberately *not* included. A festival genuinely is where the show is, so its
 * name identifies a place in a way a tour name never does.
 */
const TOUR_NAME_PATTERNS = [
  /\btour\b/i,
  /^supporting\b/i,
  /\sw\/\s/i,
  /\bpresents\b/i,
  // The party and film-score shapes, promoted into the clustering tier on the
  // same evidence bar as "tour": measured on production (2026-08-06), every
  // matching row was an event title and none was a room — birthday 6/6,
  // celebration 25/25, "in concert" 20/20 of a 97-row sample. The proof it was
  // needed: "Buddy Guy 90th Birthday Concert" sat on Radio City Music Hall's
  // exact coordinates holding 33 events, and with a name that still vouched it
  // *conflicted* with the hall instead of merging into it. Bare "concert" stays
  // out — 378 rows, dominated by real Concert Halls and Concert Series.
  /\bbirthday\b/i,
  /\bcelebration\b/i,
  /\bin concert\b/i,
];

export function looksLikeTourName(name: string): boolean {
  return TOUR_NAME_PATTERNS.some((re) => re.test(name));
}

/** Past this a "venue name" is a sentence, and rooms are not named in sentences. */
export const VENUE_NAME_MAX = 64;

/**
 * Does this "venue name" name an event rather than a place?
 *
 * A superset of `looksLikeTourName`, answering a different question: not "may this
 * name vouch for a venue's identity?" but "may it be shown to somebody as a
 * venue?". Two shapes reach the table that the tour patterns miss, both counted on
 * the live one:
 *
 * - a colon — 222 rows, e.g. "Horse Jumper of Love: playing their Self Titled
 *   Debut in its entirety", "Drops of Jupiter: 25 Years in the Atmosphere". Venues
 *   don't introduce themselves;
 * - longer than a name gets — 67 rows.
 *
 * One more shape here, added after "Buddy Guy 90th Birthday Concert" won a
 * cluster head election on Radio City Music Hall's coordinates and titled an
 * Alabama Shakes event page (the party and film-score words from that incident
 * live in `TOUR_NAME_PATTERNS` — measured clean enough for clustering itself):
 *
 * - a pipe with a trailing "City, ST" — all 8 such rows on production
 *   (2026-08-06) were billings ("Buddy Guy 90 | Majestic Theatre - San
 *   Antonio, TX", "ROCK THE STOCKYARD FEST | BRISTOL, TN"). A pipe alone is
 *   NOT enough: "Godfrey Daniels | Live Music Listening Room" is a real venue
 *   wearing a descriptor. Display-only on purpose — these names still carry
 *   real venue tokens ("Majestic Theatre"), which is exactly what lets the
 *   same-spot merge place them under the right head.
 *
 * Deliberately not folded into `looksLikeTourName`. That one governs *clustering*,
 * where a false positive quietly merges two rooms and loses shows, so it stays
 * narrow. This one only governs what gets printed, where a false positive costs a
 * line of detail and a false negative prints a lie — so it can afford to be blunt.
 */
// The comma must follow a real word, not sit empty ("Foo | , TX" is nobody's
// billing). Two capitals suffice for the "state": all 8 production rows carry
// genuine codes, and a maintained state allowlist would outweigh a rule whose
// false positive costs one displayed line.
const EVENT_TITLE_PATTERNS = [/\|[^|]*\w,\s*[A-Z]{2}$/];

export function looksLikeEventTitle(name: string | null | undefined): boolean {
  const n = name?.trim();
  // Absent is a different problem from wrong, and callers handle it differently.
  if (!n) return false;
  return (
    n.length > VENUE_NAME_MAX ||
    n.includes(':') ||
    looksLikeTourName(n) ||
    EVENT_TITLE_PATTERNS.some((re) => re.test(n))
  );
}

/**
 * The venue name with any tour-shaped dash segment removed, or null when there
 * is nothing to strip. "YORK BARBICAN - A Happy Christmas Tour 2026" is a real
 * room wearing this season's booking; "UK TOUR 2026 - The Cluny 2 - Newcastle"
 * wears it as a prefix instead. Segments are judged by `looksLikeTourName` —
 * the same rule that already suppresses whole names — so this creates no new
 * false-positive class, and a name that is only tour segments comes back null
 * untouched (that's `looksLikeEventTitle`'s case, not a repair).
 */
export function cleanVenueName(name: string | null | undefined): string | null {
  const n = name?.trim();
  if (!n || !n.includes(' - ')) return null;
  const segments = n.split(' - ').map((s) => s.trim());
  const kept = segments.filter((s) => s && !looksLikeTourName(s));
  if (kept.length === 0 || kept.length === segments.filter(Boolean).length) return null;
  return kept.join(' - ');
}

/**
 * Is this "venue name" a dash-separated billing — "MGMT DJ SET - San Francisco",
 * "JOURNEY OF A LIFETIME - MIAMI" — rather than a room?
 *
 * A string rule can't answer this: "Fox Theater - Oakland" and "MGMT DJ SET -
 * San Francisco" are the same shape, and SeatGeek writes that redundant city
 * suffix on perfectly real rooms (measured on production, 2026-07-31). So the
 * question needs the listing's own context, which only the source mapping has:
 * the suffix must be the listing's own city, *and* the prefix must vouch
 * against itself — by carrying the act's own name (no room is named after
 * tonight's act) or by reading as a tour. Both conditions, deliberately: either
 * alone junks real venues ("PALAIS DES CONGRES - SALLE MAURICE RAVEL" is
 * all-caps and dashed; "Bottom of the Hill - San Francisco" suffixes its city).
 *
 * Known miss, accepted: a club-night brand with no artist token ("PROGRESSIVE
 * HOUSE NEVER DIED - Seattle") passes both guards and stays a known miss —
 * there is nothing in the listing that distinguishes it from a room.
 */
export function dashBillingVenueName(
  name: string | null | undefined,
  city: string | null | undefined,
  artistName: string | null | undefined,
): boolean {
  const n = name?.trim();
  const town = city?.trim();
  if (!n || !town) return false;
  const cut = n.lastIndexOf(' - ');
  if (cut <= 0) return false;
  const prefix = n.slice(0, cut).trim();
  const suffix = n.slice(cut + 3).trim();
  if (!prefix || !suffix) return false;
  const fold = (s: string) => normalizeWords(s).join(' ');
  const suffixWords = fold(suffix);
  const townWords = fold(town);
  // Non-Latin names ("東京") fold to nothing, so they compare raw instead of
  // silently never matching.
  const suffixIsTown =
    suffixWords || townWords
      ? !!suffixWords && suffixWords === townWords
      : suffix.toLowerCase() === town.toLowerCase();
  if (!suffixIsTown) return false;
  if (looksLikeTourName(prefix)) return true;
  return nameCarriesAct(prefix, artistName);
}

/**
 * Does this name carry the act's own name, whole tokens only? No room is named
 * after tonight's act, so a "venue" that is, is the billing. Whole tokens, not
 * substrings: the band War must not claim Warlord Theater.
 */
export function nameCarriesAct(name: string, artistName: string | null | undefined): boolean {
  const actTokens = normalizeWords(artistName ?? '');
  if (actTokens.length === 0) return false;
  const nameTokens = new Set(normalizeWords(name));
  return actTokens.every((t) => nameTokens.has(t));
}

const normalizeWords = (s: string): string[] =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 1);

/**
 * @param city When given, the town's own words are dropped from the name \u2014 in its
 * own town a city name distinguishes nothing. "Metro Chicago" and "Radius Chicago"
 * are two different rooms that agree on nothing but the word "chicago", and that
 * shared word was enough for `venueNamesAgree` to merge them. Measured on
 * production before this landed: of a 60-cluster sample holding 3+ distinct names,
 * 11 had a pair whose only shared words were the town's \u2014 "Manchester Club
 * Academy", "O2 Ritz Manchester" and "O2 Apollo Manchester" fused into one row is
 * the textbook case.
 */
export function venueNameTokens(name: string, city?: string | null): Set<string> {
  // A tour title vouches for nothing, so it gets no tokens: it cannot agree with a
  // name, and it cannot conflict with one either.
  if (looksLikeTourName(name)) return new Set();
  const cityWords = city ? new Set(normalizeWords(city)) : null;
  const tokens = normalizeWords(name).filter((t) => !STOPWORDS.has(t) && !cityWords?.has(t));
  return new Set(tokens);
}

/** Non-empty and token-for-token equal. */
function sameTokens(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || a.size !== b.size) return false;
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

/**
 * Token-for-token the same name, city words included.
 *
 * The escape hatch for venues named after their own town. "Royal Oak Music
 * Theatre" in Royal Oak is nothing but city words and stopwords, so the city-drop
 * empties it and it could never vouch for itself again — but two rows in one town
 * carrying the *identical* name are one room, city words or not. A single shared
 * word is weak evidence; the whole name is not.
 */
function identicalNames(a: string, b: string): boolean {
  return sameTokens(venueNameTokens(a), venueNameTokens(b));
}

/**
 * Do these two names share a distinguishing word? A name made only of generic
 * words ("The Music Hall") can't vouch for anything, so it fails: this is only
 * consulted between 50m and 300m, a range that holds several different rooms, and
 * the same building at the same coordinates is already matched without a name.
 * Missing a duplicate costs a repeated row; merging two venues loses shows.
 */
export function venueNamesAgree(a: string, b: string, city?: string | null): boolean {
  if (identicalNames(a, b)) return true;
  const ta = venueNameTokens(a, city);
  const tb = venueNameTokens(b, city);
  if (ta.size === 0 || tb.size === 0) return false;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

/**
 * Do these two names actively disagree — each carries a distinguishing word and
 * they have none in common?
 *
 * This is what stops a placeholder coordinate from swallowing a city. Ticketmaster
 * returns a city centroid for venues it has no address for, and returns the *same*
 * centroid for all of them: five San Francisco rooms — Warfield, Golden Gate Park,
 * Davies Symphony Hall, Golden Gate Theater, Rickshaw Stop — arrived on
 * 37.779499,-122.419502, zero metres apart, and merged into one venue that then
 * showed Interpol at the symphony hall.
 *
 * Two all-generic names ("The Theatre", "Music Hall") don't conflict, because
 * neither claims anything to disagree about — the same-spot rule still joins those.
 * The cost is a genuinely shared building whose names have nothing in common (Cafe
 * Du Nord and Swedish American Hall are one address), which now stays two rows.
 * That is the cheaper error on purpose: a duplicate row repeats a show, a bad merge
 * moves every show in the cluster to the wrong room.
 */
export function venueNamesConflict(a: string, b: string, city?: string | null): boolean {
  const ta = venueNameTokens(a, city);
  const tb = venueNameTokens(b, city);
  if (ta.size === 0 || tb.size === 0) return false;
  for (const t of ta) if (tb.has(t)) return false;
  return true;
}

/**
 * How many unrelated rooms have to share one exact coordinate before we stop
 * believing the coordinate. Two is too low: a complex genuinely files its rooms at
 * one point ("The Salt Shed Indoors", "The Salt Shed Outdoors"), and those names
 * agree with each other so they group into one. Three *mutually unrelated* names is
 * not a building, it is a default.
 */
export const PLACEHOLDER_POINT_GROUPS = 3;

/**
 * Is this exact coordinate a source's fallback for "somewhere in this city"?
 *
 * Ticketmaster answers with one point per town for every venue it has no address
 * for — verified live: it gives 37.779499,-122.419502 for both Golden Gate Park and
 * Rickshaw Stop, which are 4km and 300m from there respectively. A point like that
 * carries no information about where anything is, so a row sitting on it is a bad
 * choice to *name and place* a cluster even when it is a fine member of one.
 *
 * The test is how many unrelated rooms are filed at the point: names are grouped by
 * shared distinguishing words, so a venue's own variants collapse together and only
 * genuinely different places count. Tour titles have no tokens and are ignored —
 * they say nothing either way.
 */
export function isPlaceholderPoint(namesAtPoint: string[]): boolean {
  const groups: Set<string>[] = [];
  for (const name of namesAtPoint) {
    const tokens = venueNameTokens(name);
    if (tokens.size === 0) continue;
    // Every group this name touches is folded into one, not just the first: a
    // name can be the word that shows two earlier groups were the same room.
    const touched: Set<string>[] = [];
    for (const g of groups) {
      for (const t of tokens) {
        if (g.has(t)) {
          touched.push(g);
          break;
        }
      }
    }
    if (touched.length === 0) {
      groups.push(new Set(tokens));
      continue;
    }
    const merged = touched[0];
    for (const t of tokens) merged.add(t);
    for (const g of touched.slice(1)) {
      for (const t of g) merged.add(t);
      groups.splice(groups.indexOf(g), 1);
    }
  }
  return groups.length >= PLACEHOLDER_POINT_GROUPS;
}

/** Key for "the same exact coordinate", for grouping rows by point. */
export function pointKey(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  return `${lat},${lng}`;
}

/**
 * One name contains the other, once the generic words are gone: "The Eastern" vs
 * "The Eastern-GA", "Agora Theatre" vs "Agora Theater & Ballroom". Two genuinely
 * different rooms rarely nest like this ("Brooklyn Bowl" and "Brooklyn Steel"
 * don't), which is what makes it safe to trust over a long distance.
 */
export function venueNamesMatchStrongly(a: string, b: string, city?: string | null): boolean {
  if (identicalNames(a, b)) return true;
  const ta = venueNameTokens(a, city);
  const tb = venueNameTokens(b, city);
  if (ta.size === 0 || tb.size === 0) return false;
  const [smaller, larger] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const t of smaller) if (!larger.has(t)) return false;
  return true;
}

export type VenuePoint = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  city?: string | null;
};

const sameTown = (a: VenuePoint, b: VenuePoint): boolean =>
  Boolean(a.city && b.city) && a.city!.trim().toLowerCase() === b.city!.trim().toLowerCase();

/**
 * Is this the same physical venue? Same spot wins unless the names contradict
 * each other, because a shared coordinate is as likely to be a source's city
 * centroid as a real address; near-but-not-exact needs the names to agree,
 * because city blocks hold several rooms; and further out it takes a nested name
 * in the same town, to survive coordinates that point at the city rather than the
 * building.
 *
 * Refusing the same-spot merge is what lets the right match win: Ticketmaster's
 * "Warfield" sitting on the San Francisco centroid no longer absorbs Golden Gate
 * Park, so it falls through to the nested-name rule and joins the real "The
 * Warfield" 900m away, which is where its shows belong.
 */
export function sameVenue(a: VenuePoint, b: VenuePoint): boolean {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  const meters = metersBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  // The town both sides answer to. One value serves both names; when the two rows
  // *disagree* about their city (a boundary spelling — "Brooklyn" vs "New York"),
  // no city is dropped at all, because picking either side's would make
  // sameVenue(a, b) differ from sameVenue(b, a) and the clusters flap with
  // processing order. Conservative and symmetric beats clever here.
  const cityA = a.city?.trim().toLowerCase() ?? null;
  const cityB = b.city?.trim().toLowerCase() ?? null;
  const town = cityA && cityB ? (cityA === cityB ? a.city! : null) : (a.city ?? b.city ?? null);
  if (meters <= VENUE_SAME_SPOT_METERS && !venueNamesConflict(a.name, b.name, town)) return true;
  if (meters <= VENUE_MATCH_METERS && venueNamesAgree(a.name, b.name, town)) return true;
  return meters <= VENUE_SAME_NAME_METERS && sameTown(a, b) && venueNamesMatchStrongly(a.name, b.name, town);
}

/**
 * May this row join a cluster whose members are these?
 *
 * `sameVenue` is pairwise, and clustering is not: "Three Links Deep Ellum" matched
 * "The Factory In Deep Ellum" on the neighbourhood words, the Factory had already
 * (correctly — it's the same room renamed) absorbed "The Bomb Factory", and the
 * transitive result was Three Links filed under The Bomb Factory: two genuinely
 * different Dallas rooms, chained through an intermediate both could reach. The
 * candidate has to agree with the members already in the cluster, not just the row
 * it happened to be compared against.
 *
 * Members that can't be judged don't get a veto: a tour-title row has no name
 * tokens to agree *or* disagree with, and a row with no coordinates can't be
 * distance-checked. A token-less candidate skips the check entirely — it matched on
 * location alone and claims nothing the cluster could contradict.
 */
export function agreesWithCluster(candidate: VenuePoint, members: VenuePoint[]): boolean {
  if (venueNameTokens(candidate.name).size === 0) return true;
  for (const m of members) {
    if (m.id === candidate.id) continue;
    if (m.lat == null || m.lng == null) continue;
    if (venueNameTokens(m.name).size === 0) continue;
    if (!sameVenue(candidate, m)) return false;
  }
  return true;
}

/** The closest venue in `candidates` that is the same place as `target`. */
export function bestVenueMatch(target: VenuePoint, candidates: VenuePoint[]): VenuePoint | null {
  let best: VenuePoint | null = null;
  let bestMeters = Infinity;
  for (const c of candidates) {
    if (c.id === target.id || !sameVenue(target, c)) continue;
    const meters = metersBetween(
      { lat: target.lat!, lng: target.lng! },
      { lat: c.lat!, lng: c.lng! },
    );
    if (meters < bestMeters) {
      best = c;
      bestMeters = meters;
    }
  }
  return best;
}

/**
 * Bandsintown sends venue-local time with no offset ("2026-08-06T16:30:00"), so
 * storing it as UTC puts a show hours off. Longitude gives the standard offset
 * to within an hour or so — wrong by a DST hour beats wrong by eight, and the
 * merge below prefers a source that publishes real UTC.
 */
export function guessUtcOffsetHours(lng: number | null | undefined): number {
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return 0;
  return Math.max(-12, Math.min(14, Math.round(lng / 15)));
}

export function hoursApart(a: string, b: string): number {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.abs(ta - tb) / 3_600_000;
}

/** Same artist, same venue, close enough in time to be one show. */
export function sameShow(
  a: { artistId: string; venueId: string | null; startsAt: string; timeUnknown?: boolean | null },
  b: { artistId: string; venueId: string | null; startsAt: string; timeUnknown?: boolean | null },
): boolean {
  if (a.artistId !== b.artistId) return false;
  if (!a.venueId || !b.venueId || a.venueId !== b.venueId) return false;
  const window = a.timeUnknown || b.timeUnknown ? TBD_SHOW_MATCH_HOURS : SHOW_MATCH_HOURS;
  return hoursApart(a.startsAt, b.startsAt) <= window;
}

/**
 * Which source's value to keep when two listings describe one show. Ticketmaster
 * owns prices, real UTC times and the marketing name; Bandsintown owns the
 * lineup and the sold-out/free flags. Neither should be able to blank a field
 * the other filled in.
 *
 * SeatGeek joins Ticketmaster on `starts_at` because it publishes a true UTC
 * timestamp *and* the venue's IANA zone, so its time is measured rather than
 * inferred — either may correct a Bandsintown guess. It does not own `price_from`:
 * `stats.lowest_price` is the cheapest resale listing, which can sit either side
 * of Ticketmaster's face value, so it only fills a price nobody else knows. Same
 * for `ticket_url` — a SeatGeek link is fine when there's no primary one, but it
 * shouldn't displace the box office. `name` stays Ticketmaster's: SeatGeek titles
 * carry booking noise ("Johnny Dynamite (21+)"). And it contributes no `ends_at`
 * at all — see `sgToEventInputs` for why that field is a template, not a fact.
 */
export const FIELD_OWNER: Record<string, string[]> = {
  starts_at: ['ticketmaster', 'seatgeek'],
  name: ['ticketmaster'],
  price_from: ['ticketmaster'],
  ticket_url: ['ticketmaster'],
  lineup: ['bandsintown', 'seatgeek'],
  sold_out: ['bandsintown'],
  is_free: ['bandsintown'],
  ends_at: ['bandsintown'],
};

/** Should `incomingSource` overwrite a value already set by `existingSource`? */
export function prefersSource(field: string, incomingSource: string, existingSource: string): boolean {
  // A source is always allowed to correct its own earlier answer.
  if (incomingSource === existingSource) return true;
  // Otherwise only the field's owner may overwrite; anything else leaves it be.
  return FIELD_OWNER[field]?.includes(incomingSource) ?? false;
}

/**
 * The value to store for one field of a merged show. An empty slot is always
 * filled — ownership only decides who wins a contest between two real values.
 */
export function mergeField<T>(
  field: string,
  incoming: T | null | undefined,
  existing: T | null | undefined,
  incomingSource: string,
  existingSource: string,
): T | null {
  if (incoming === null || incoming === undefined) return existing ?? null;
  if (existing === null || existing === undefined) return incoming;
  return prefersSource(field, incomingSource, existingSource) ? incoming : existing;
}

/**
 * The `{source: upstream_id}` provenance map. Values must be strings — this feeds
 * a `json_extract(...) = ?` lookup, where a number or a nested object would
 * silently never match — so anything else is dropped rather than carried.
 */
export function parseSources(json: string | null): Record<string, string> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(
      Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return {};
  }
}
