import { describe, expect, it } from 'vitest';

import {
  ARTICLE_MAX_METERS,
  articleFits,
  cleanCredit,
  CREDIT_MAX,
  fileNameFrom,
  filePageUrl,
  scaledImageUrl,
  sharesDistinguishingWord,
  type Article,
} from '../src/venue-info';

/** A Wikipedia summary, with only the fields the guards read. */
const article = (title: string, lat: number | null, lng: number | null): Article => ({
  title,
  extract: 'x'.repeat(400),
  url: null,
  lat,
  lng,
  imageUrl: null,
});

describe('venue article guards', () => {
  // Every row below is a real venue and a real article, recorded from a sample of
  // 22 production venues. The five rejections are the whole reason the guards
  // exist: each one is an article a plain title lookup returns happily.
  it('keeps the article when it is a place, near the venue, sharing its name', () => {
    const kept: [string, number, number, string, number, number][] = [
      ['Moody Center', 30.2837, -97.7325, 'Moody Center', 30.2833, -97.7325],
      ['Chicago Theater', 41.8853, -87.6276, 'Chicago Theatre', 41.8853, -87.6276],
      ['Bowery Ballroom', 40.7204, -73.9934, 'Bowery Ballroom', 40.7204, -73.9934],
      ['Webster Hall', 40.7318, -73.9887, 'Webster Hall', 40.7318, -73.9887],
      ['Great American Music Hall', 37.7852, -122.4187, 'Great American Music Hall', 37.7852, -122.4187],
      ['MGM Music Hall at Fenway', 42.3467, -71.0972, 'MGM Music Hall at Fenway', 42.3468, -71.0975],
      ['Brooklyn Paramount', 40.6893, -73.9814, 'Brooklyn Paramount', 40.6894, -73.9815],
      ['Oakland Arena', 37.7503, -122.2031, 'Oakland Arena', 37.7502, -122.2036],
      // Filed under a disambiguated title, found by search — the shared word carries it.
      ['Birdland Theater', 40.7589, -73.9896, 'Birdland (New York jazz club)', 40.7589, -73.9896],
      ['State Theatre', -33.8709, 151.2073, 'State Theatre (Sydney)', -33.8709, 151.2073],
      ['Pensacola Saenger Theatre', 30.4093, -87.2136, 'Saenger Theatre (Pensacola, Florida)', 30.4094, -87.2137],
      // 7.6 km apart, and the article is right: Ticketmaster stamped our row with
      // the town centroid. This is exactly why the radius is loose.
      ['Red Rocks Amphitheatre', 39.6533, -105.2035, 'Red Rocks Amphitheatre', 39.6655, -105.2057],
    ];
    for (const [name, vLat, vLng, title, aLat, aLng] of kept) {
      expect(
        articleFits(article(title, aLat, aLng), { name, city: null, lat: vLat, lng: vLng }),
        `${name} -> ${title}`,
      ).toBe(true);
    }
  });

  it('rejects an article that is not a place at all', () => {
    // A record label, and an article about the Italian word for "coastline".
    // Neither carries coordinates, which is the only thing that separates them
    // from the venue: both share every word of the name they were found by.
    expect(
      articleFits(article('Blue Note Records', null, null), {
        name: 'Blue Note',
        city: 'New York',
        lat: 40.7308,
        lng: -74.0007,
      }),
    ).toBe(false);
    expect(
      articleFits(article('Riviera', null, null), {
        name: 'Riviera',
        city: 'Burgos',
        lat: 42.3439,
        lng: -3.6969,
      }),
    ).toBe(false);
  });

  it("rejects the venue's own town, which is a place and is nearby", () => {
    // Both of these pass the distance guard comfortably — a town centre is close to
    // a venue in that town — so the name check is the only thing standing between
    // a venue page and a paragraph about local government.
    expect(
      articleFits(article('Venlo', 51.3704, 6.1724), {
        name: 'Grenswerk',
        city: 'Venlo',
        lat: 51.3702,
        lng: 6.1679,
      }),
    ).toBe(false);
    expect(
      articleFits(article('Portsmouth, New Hampshire', 43.0718, -70.7626), {
        name: 'Prescott Park',
        city: 'Portsmouth',
        lat: 43.0762, // 3.25 km away: inside the radius, so distance can't save us
        lng: -70.7514,
      }),
    ).toBe(false);
    // "Music of Austin, Texas" — a real search result for a venue called "Mohawk".
    expect(
      articleFits(article('Music of Austin, Texas', 30.2672, -97.7431), {
        name: 'Mohawk',
        city: 'Austin',
        lat: 30.2686,
        lng: -97.7364,
      }),
    ).toBe(false);
  });

  it('rejects a same-named room in another city', () => {
    // The loose radius is what makes this worth asserting: it has to still be
    // tight enough to tell two Websters apart.
    expect(
      articleFits(article('Webster Hall', 40.7318, -73.9887), {
        name: 'Webster Hall',
        city: 'Chicago',
        lat: 41.8853,
        lng: -87.6276,
      }),
    ).toBe(false);
  });

  it('needs coordinates on both sides before it will trust anything', () => {
    const a = article('Bowery Ballroom', 40.7204, -73.9934);
    // A venue we cannot place cannot verify an article, and the name alone is what
    // returned a record label above.
    expect(articleFits(a, { name: 'Bowery Ballroom', city: 'New York', lat: null, lng: null })).toBe(false);
    expect(
      articleFits(article('Bowery Ballroom', null, null), {
        name: 'Bowery Ballroom',
        city: 'New York',
        lat: 40.7204,
        lng: -73.9934,
      }),
    ).toBe(false);
  });

  it('refuses to look up a row named after a tour', () => {
    // These yield no distinguishing tokens by design (see dedupe.ts), so they can
    // never match an article — which is the right answer twice over.
    for (const junk of ['Brunette World Tour', 'BILMURI presents: The KINDA HARD Tour']) {
      expect(sharesDistinguishingWord(junk, 'Brunette'), junk).toBe(false);
    }
  });

  it('ignores the generic half of a venue name', () => {
    // "hall", "theatre", "arena" and friends are shared by every other room in
    // town, so agreeing on one of them is not agreement.
    expect(sharesDistinguishingWord('Fillmore Music Hall', 'Roxy Music Hall')).toBe(false);
    expect(sharesDistinguishingWord('The Fillmore', 'Fillmore Auditorium')).toBe(true);
    // Two characters, and the whole name: "The O2" must survive tokenising.
    expect(sharesDistinguishingWord('The O2', 'The O2')).toBe(true);
  });

  it('measures the radius it documents', () => {
    // Just inside and just outside, so the constant can't drift silently.
    const at = (lat: number) => article('Test Room', lat, 0);
    const venue = { name: 'Test Room', city: null, lat: 0, lng: 0 };
    const degPerMeter = 1 / 111_320;
    expect(articleFits(at((ARTICLE_MAX_METERS - 500) * degPerMeter), venue)).toBe(true);
    expect(articleFits(at((ARTICLE_MAX_METERS + 500) * degPerMeter), venue)).toBe(false);
  });
});

describe('image attribution', () => {
  it('reads the file name out of a thumbnail URL, not the rendered size', () => {
    // The bug this exists for: `originalimage.source` is itself a thumb URL, so the
    // last path segment is "3840px-WTM_tony_0084.jpg" — a size that no File: page
    // matches. Asking Commons about it returns no licence, and an image we cannot
    // credit is an image we cannot show.
    expect(
      fileNameFrom(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/WTM_tony_0084.jpg/3840px-WTM_tony_0084.jpg',
      ),
    ).toBe('WTM_tony_0084.jpg');
    // A non-thumb URL really does end in the file.
    expect(fileNameFrom('https://upload.wikimedia.org/wikipedia/commons/e/e3/WTM_tony_0084.jpg')).toBe(
      'WTM_tony_0084.jpg',
    );
    // Percent-encoded names are common; the File: title needs them decoded.
    expect(
      fileNameFrom(
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Moody_Center_%28541%29.jpg/1200px-Moody_Center_%28541%29.jpg',
      ),
    ).toBe('Moody_Center_(541).jpg');
    expect(fileNameFrom('not a url')).toBe(null);
  });

  it('re-encodes the file name for the scaled URL', () => {
    // Round-tripping matters: the decoded name has parentheses and spaces in it.
    expect(scaledImageUrl('Moody_Center_(541).jpg', 1200)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/Moody_Center_(541).jpg?width=1200',
    );
    expect(scaledImageUrl('A B.jpg')).toContain('A%20B.jpg?width=1200');
  });

  it('points the credit at the file page, which is the source', () => {
    // CC asks for the author *and* a link to the source. The file page is that
    // link, and it is also where the full author text lives — which is what lets
    // the visible credit be shortened at all.
    expect(filePageUrl('Moody_Center_(541).jpg')).toBe(
      'https://commons.wikimedia.org/wiki/File:Moody_Center_(541).jpg',
    );
    expect(filePageUrl('A B.jpg')).toBe('https://commons.wikimedia.org/wiki/File:A%20B.jpg');
  });

  it('turns a Commons credit into something that fits under a photo', () => {
    expect(cleanCredit('<a href="/wiki/User:x" title="x">ajay_suresh</a>')).toBe('ajay_suresh');
    expect(cleanCredit('  Daniel   Schwen\n')).toBe('Daniel Schwen');
    expect(cleanCredit('Bob &amp; Alice')).toBe('Bob & Alice');
    // Red Rocks' author field is empty, and Bowery Ballroom's is a paragraph about
    // the photographer's licensing preferences. Both have to come out usable.
    expect(cleanCredit('')).toBe(null);
    expect(cleanCredit('   ')).toBe(null);
    expect(cleanCredit(null)).toBe(null);
    // Bowery Ballroom's actual author field: prose, not a name. Verified against
    // production — this is what the endpoint returned before the cap came down.
    const long = cleanCredit(
      'This photo was taken by participant/team Tony as part of the Commons:Wikipedia Takes Manhattan',
    );
    expect(long!.length).toBeLessThanOrEqual(CREDIT_MAX);
    expect(long!.endsWith('…')).toBe(true);
  });
});
