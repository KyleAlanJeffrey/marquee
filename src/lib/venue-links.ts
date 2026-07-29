/**
 * Deep links to the things people check before going out: where the venue is,
 * what it's like, and its own site.
 *
 * These are *searches*, not resolved records, and that's deliberate. None of the
 * three upstreams publishes a venue's own website — Ticketmaster and SeatGeek
 * both hand back their own venue pages — and the rating APIs (Google Places,
 * Yelp Fusion) each want a billed key plus attribution and caching rules. A
 * search link needs no key, can't go stale, and lands where a person typing the
 * name in themselves would land. If a real rating is ever worth a key, these
 * links stay as the fallback for whatever it doesn't cover.
 */

export type VenuePlace = {
  name: string;
  city?: string | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
};

const clean = (v: string | null | undefined) => v?.trim() || '';

/** "The Fillmore, San Francisco, CA" — a name alone is ambiguous across towns. */
export function venueQuery(v: VenuePlace): string {
  return [clean(v.name), clean(v.city), clean(v.region)].filter(Boolean).join(', ');
}

/**
 * The map, for getting there. Coordinates when we have them: two rooms can share
 * a name, a point can't.
 */
export function mapsUrl(v: VenuePlace): string {
  const q = v.lat != null && v.lng != null ? `${v.lat},${v.lng}` : venueQuery(v);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/**
 * Google's reviews live on the place's Maps listing, so this searches by *name*
 * even though `mapsUrl` prefers coordinates — a coordinate query centres the map
 * without selecting a place, and the reviews belong to the place.
 */
export function googleReviewsUrl(v: VenuePlace): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueQuery(v))}`;
}

export function yelpUrl(v: VenuePlace): string {
  const desc = encodeURIComponent(clean(v.name));
  const loc = encodeURIComponent([clean(v.city), clean(v.region)].filter(Boolean).join(', '));
  return `https://www.yelp.com/search?find_desc=${desc}${loc ? `&find_loc=${loc}` : ''}`;
}

/**
 * The venue's own site. A search rather than a link, because we don't hold the
 * URL: OpenStreetMap was the free option and it had no `website` tag for two of
 * four venues checked, so a button that worked half the time would be worse than
 * one that always gets you there in one more tap.
 */
export function websiteSearchUrl(v: VenuePlace): string {
  const q = `${venueQuery(v)} official site`;
  return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

export type VenueLink = { key: string; label: string; icon: string; url: string };

/** The links worth showing for a venue, in the order they're useful. */
export function venueLinks(v: VenuePlace): VenueLink[] {
  if (!clean(v.name)) return [];
  return [
    { key: 'maps', label: 'DIRECTIONS', icon: 'navigate', url: mapsUrl(v) },
    { key: 'google', label: 'GOOGLE REVIEWS', icon: 'star-outline', url: googleReviewsUrl(v) },
    { key: 'yelp', label: 'YELP', icon: 'chatbubble-ellipses-outline', url: yelpUrl(v) },
    { key: 'website', label: 'WEBSITE', icon: 'globe-outline', url: websiteSearchUrl(v) },
  ];
}
