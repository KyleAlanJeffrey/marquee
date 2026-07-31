/**
 * What a room is actually like: a description and a photograph of it.
 *
 * Wikipedia is the only free source that has either. It is also the only source
 * here whose *wrong* answers are more dangerous than its missing ones, because a
 * venue name is short, generic, and collides with words, record labels and towns.
 * Measured against 22 real venue rows before any of this was written: 14 direct
 * title hits, 6 rescued by a title search, 2 with no article — and five confident
 * mismatches that a naive lookup would have published as fact.
 *
 *   "Blue Note"      (New York)  -> "Blue Note Records", the record label
 *   "Riviera"        (Burgos)    -> the Italian word for coastline
 *   "Mohawk"         (Austin)    -> "Music of Austin, Texas"
 *   "Grenswerk"      (Venlo)     -> "Venlo", the town
 *   "Prescott Park"  (Portsmouth)-> "Portsmouth, New Hampshire", the town
 *
 * So a candidate article has to earn its place, through two guards that between
 * them were exactly right on that sample — 14 kept, all correct; 5 dropped, all
 * correctly dropped:
 *
 * 1. **It has to be a place, near this place.** Wikipedia gives coordinates for
 *    geographic articles, and we know where the venue is. The label, the
 *    dictionary word and the city-music article all fail this outright: none of
 *    them are places, so none of them carry coordinates.
 * 2. **Its title has to share a distinguishing word with the venue's name.** The
 *    town articles pass the first guard easily — a town centre is near the venue
 *    in it — and fail this one, because "Portsmouth, New Hampshire" has nothing in
 *    common with "Prescott Park".
 *
 * The distance allowed is deliberately loose, because the coordinate we're
 * comparing against is often *ours* and ours is sometimes wrong: Ticketmaster
 * stamps venues it has no address for with the town centroid, which puts Red Rocks
 * 7.6 km from its own article. Tightening this would reject real rooms to punish
 * our own placeholder data.
 */

import { metersBetween, venueNameTokens } from './dedupe';

const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_FILE = 'https://commons.wikimedia.org/wiki/Special:FilePath';

/** Wikipedia asks for a real agent with a contact; anonymous bulk reads get blocked. */
const UA = 'Marquee/1.0 (concert discovery; https://marquee.rocks)';
const HEADERS = { 'User-Agent': UA, accept: 'application/json' };

/**
 * How far an article may sit from where we think the venue is. Generous on
 * purpose — see the note above about our own coordinates being the unreliable half
 * of this comparison. Still tight enough that a same-named room in another city
 * can't claim it.
 */
export const ARTICLE_MAX_METERS = 25_000;

/**
 * Shorter than this isn't a description, it's a stub. "The Showbox" comes back as
 * 109 characters, which reads as a mistake on a page that has room for prose.
 */
export const MIN_DESCRIPTION = 160;

/** A credit longer than this stops being a name and starts being a paragraph. */
export const CREDIT_MAX = 42;

/** Wikipedia's own summary of the article, as far as we care about it. */
export type Article = {
  title: string;
  extract: string;
  url: string | null;
  lat: number | null;
  lng: number | null;
  imageUrl: string | null;
};

export type VenuePlace = {
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
};

/**
 * Does this article describe *this* venue? Both guards, and the reasoning for each
 * is in the file header.
 *
 * Returns false when the venue has no coordinates of its own: with nothing to
 * compare against, the first guard can't run, and the title check alone is not
 * enough — "Riviera" would sail through it.
 */
export function articleFits(article: Article, venue: VenuePlace): boolean {
  if (article.lat == null || article.lng == null) return false;
  if (venue.lat == null || venue.lng == null) return false;
  const away = metersBetween(
    { lat: venue.lat, lng: venue.lng },
    { lat: article.lat, lng: article.lng },
  );
  if (away > ARTICLE_MAX_METERS) return false;
  return sharesDistinguishingWord(venue.name, article.title);
}

/**
 * Do these two names agree on something that identifies a place? Reuses the
 * venue tokeniser, so "hall", "theatre", "arena" and friends are already excluded
 * as the generic words they are — and so a row named after a tour yields no tokens
 * and can never match an article, which is the right answer for it too.
 */
export function sharesDistinguishingWord(venueName: string, articleTitle: string): boolean {
  const a = venueNameTokens(venueName);
  if (a.size === 0) return false;
  const b = venueNameTokens(articleTitle);
  for (const t of a) if (b.has(t)) return true;
  return false;
}

/**
 * The Commons file name behind an image URL.
 *
 * `originalimage.source` is itself usually a *thumbnail* URL — the shape is
 * `/commons/thumb/e/e3/<FILE>/3840px-<FILE>` — so the last path segment is a
 * rendered size, not the file. Taking it verbatim asks Commons about
 * "3840px-WTM_tony_0084.jpg", which does not exist, and the licence comes back
 * empty: the image then can't be shown at all, because it can't be credited.
 */
export function fileNameFrom(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const viaThumb = parts.indexOf('thumb');
    const seg = viaThumb === -1 ? parts[parts.length - 1] : parts[parts.length - 2];
    return seg ? decodeURIComponent(seg) : null;
  } catch {
    return null;
  }
}

/** A hero-sized copy. The original is often several megabytes — Bowery Ballroom's
 *  is 3888px and 1.6 MB, against 300 KB at this width. */
export function scaledImageUrl(file: string, width = 1200): string {
  return `${COMMONS_FILE}/${encodeURIComponent(file)}?width=${width}`;
}

/**
 * The file's own page on Commons, which is where the full author, licence and
 * source live.
 *
 * This is the link the credit points at, and it is what makes a shortened credit
 * defensible. Bowery Ballroom's author field is not a name — it reads "This photo
 * was taken by participant/team Tony as part of the Commons:Wikipedia…" and runs
 * on — so it cannot be reproduced verbatim under a photograph. CC's own guidance
 * is to credit the author and link to the source; the link carries what the line
 * has no room for.
 */
export function filePageUrl(file: string): string {
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}`;
}

/**
 * Commons credits are HTML, and they range from a bare username to a paragraph
 * explaining the photographer's licensing preferences. Strip the markup, collapse
 * the whitespace, and cut it to something that fits under a photo.
 */
export function cleanCredit(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  // Short enough to sit on one line under a photo. Truncating an author is only
  // acceptable because the credit links to the file page, which carries it whole.
  return text.length > CREDIT_MAX ? `${text.slice(0, CREDIT_MAX - 1).trimEnd()}…` : text;
}

const json = async (url: string): Promise<any | null> => {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return null;
  try {
    return await r.json();
  } catch {
    return null;
  }
};

function toArticle(j: any): Article | null {
  if (!j || j.type === 'disambiguation' || typeof j.extract !== 'string') return null;
  const extract = j.extract.replace(/\s+/g, ' ').trim();
  if (extract.length < MIN_DESCRIPTION) return null;
  return {
    title: typeof j.title === 'string' ? j.title : '',
    extract,
    url: j.content_urls?.desktop?.page ?? null,
    lat: typeof j.coordinates?.lat === 'number' ? j.coordinates.lat : null,
    lng: typeof j.coordinates?.lon === 'number' ? j.coordinates.lon : null,
    imageUrl: typeof j.originalimage?.source === 'string' ? j.originalimage.source : null,
  };
}

/** The photo's licence and author, or null when it can't be established — in which
 *  case the photo is not used, because an unattributed CC image is a licence
 *  breach and we can't tell a free photo from a non-free logo without this. */
async function imageLicense(imageUrl: string) {
  const file = fileNameFrom(imageUrl);
  if (!file) return null;
  const j = await json(
    `${WIKI_API}?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(
      `File:${file}`,
    )}`,
  );
  const pages = j?.query?.pages;
  if (!pages) return null;
  const meta = (Object.values(pages)[0] as any)?.imageinfo?.[0]?.extmetadata;
  const license = cleanCredit(meta?.LicenseShortName?.value);
  if (!license) return null;
  // Non-free files are hosted on en.wikipedia rather than Commons and say so here.
  // A fair-use album cover or logo must not become a venue's hero image.
  if (/fair use|non-free/i.test(license)) return null;
  return {
    url: scaledImageUrl(file),
    credit: cleanCredit(meta?.Artist?.value),
    license,
    // The file page, not the licence deed: this is the "source" half of the
    // attribution, and it holds the full author text a one-line credit can't.
    licenseUrl: filePageUrl(file),
  };
}

export type VenueEnrichment = {
  description: string | null;
  descriptionUrl: string | null;
  photoUrl: string | null;
  photoCredit: string | null;
  photoLicense: string | null;
  photoLicenseUrl: string | null;
};

const EMPTY: VenueEnrichment = {
  description: null,
  descriptionUrl: null,
  photoUrl: null,
  photoCredit: null,
  photoLicense: null,
  photoLicenseUrl: null,
};

/**
 * Look this room up on Wikipedia. Two requests in the common case: the article by
 * its own name, then the photo's licence. A third when the name isn't a title.
 *
 * Never throws — a venue page must render without this, and most venues have no
 * article at all.
 */
export async function fetchVenueEnrichment(venue: VenuePlace): Promise<VenueEnrichment> {
  try {
    const name = venue.name.trim();
    // No tokens means a tour title or nothing but generic words; there is no
    // article to find and the guard would reject anything we did find.
    if (!name || venueNameTokens(name).size === 0) return EMPTY;

    let article = toArticle(await json(`${WIKI_REST}/${encodeURIComponent(name)}`));
    if (!article || !articleFits(article, venue)) {
      // The name is often not the article's title ("Birdland Theater" is filed as
      // "Birdland (New York jazz club)"). Naming the town narrows it.
      const q = [name, venue.city, 'music venue'].filter(Boolean).join(' ');
      const s = await json(
        `${WIKI_API}?action=query&list=search&srlimit=1&format=json&srsearch=${encodeURIComponent(q)}`,
      );
      const hit = s?.query?.search?.[0]?.title;
      article = hit ? toArticle(await json(`${WIKI_REST}/${encodeURIComponent(hit)}`)) : null;
    }
    if (!article || !articleFits(article, venue)) return EMPTY;

    const photo = article.imageUrl ? await imageLicense(article.imageUrl).catch(() => null) : null;
    return {
      description: article.extract,
      descriptionUrl: article.url,
      photoUrl: photo?.url ?? null,
      photoCredit: photo?.credit ?? null,
      photoLicense: photo?.license ?? null,
      photoLicenseUrl: photo?.licenseUrl ?? null,
    };
  } catch {
    return EMPTY;
  }
}
