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

export function venueNameTokens(name: string): Set<string> {
  const tokens = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return new Set(tokens);
}

/**
 * Do these two names share a distinguishing word? A name made only of generic
 * words ("The Music Hall") can't vouch for anything, so it fails: this is only
 * consulted between 50m and 300m, a range that holds several different rooms, and
 * the same building at the same coordinates is already matched without a name.
 * Missing a duplicate costs a repeated row; merging two venues loses shows.
 */
export function venueNamesAgree(a: string, b: string): boolean {
  const ta = venueNameTokens(a);
  const tb = venueNameTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  for (const t of ta) if (tb.has(t)) return true;
  return false;
}

/**
 * One name contains the other, once the generic words are gone: "The Eastern" vs
 * "The Eastern-GA", "Agora Theatre" vs "Agora Theater & Ballroom". Two genuinely
 * different rooms rarely nest like this ("Brooklyn Bowl" and "Brooklyn Steel"
 * don't), which is what makes it safe to trust over a long distance.
 */
export function venueNamesMatchStrongly(a: string, b: string): boolean {
  const ta = venueNameTokens(a);
  const tb = venueNameTokens(b);
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
 * Is this the same physical venue? Same spot wins outright; near-but-not-exact
 * needs the names to agree, because city blocks hold several rooms; and further
 * out it takes a nested name in the same town, to survive coordinates that point
 * at the city rather than the building.
 */
export function sameVenue(a: VenuePoint, b: VenuePoint): boolean {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return false;
  const meters = metersBetween({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
  if (meters <= VENUE_SAME_SPOT_METERS) return true;
  if (meters <= VENUE_MATCH_METERS && venueNamesAgree(a.name, b.name)) return true;
  return meters <= VENUE_SAME_NAME_METERS && sameTown(a, b) && venueNamesMatchStrongly(a.name, b.name);
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
  a: { artistId: string; venueId: string | null; startsAt: string },
  b: { artistId: string; venueId: string | null; startsAt: string },
): boolean {
  if (a.artistId !== b.artistId) return false;
  if (!a.venueId || !b.venueId || a.venueId !== b.venueId) return false;
  return hoursApart(a.startsAt, b.startsAt) <= SHOW_MATCH_HOURS;
}

/**
 * Which source's value to keep when two listings describe one show. Ticketmaster
 * owns prices, real UTC times and the marketing name; Bandsintown owns the
 * lineup and the sold-out/free flags. Neither should be able to blank a field
 * the other filled in.
 */
export const FIELD_OWNER: Record<string, string[]> = {
  starts_at: ['ticketmaster'],
  name: ['ticketmaster'],
  price_from: ['ticketmaster'],
  ticket_url: ['ticketmaster'],
  lineup: ['bandsintown'],
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
