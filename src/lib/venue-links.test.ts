import { describe, expect, it } from 'vitest';

import { googleReviewsUrl, mapsUrl, venueLinks, venueQuery, websiteSearchUrl, yelpUrl } from './venue-links';

const fillmore = { name: 'The Fillmore', city: 'San Francisco', region: 'CA', lat: 37.7842, lng: -122.4332 };

describe('venueQuery', () => {
  it('qualifies the name with its town, since names repeat', () => {
    // There is a Fillmore in San Francisco and another in Silver Spring, MD.
    expect(venueQuery(fillmore)).toBe('The Fillmore, San Francisco, CA');
  });

  it('drops the parts a venue row may not have', () => {
    expect(venueQuery({ name: 'Somewhere', city: null, region: '' })).toBe('Somewhere');
  });
});

describe('venue links', () => {
  it('sends the map to coordinates and the reviews to the named place', () => {
    // A coordinate query centres the map but selects nothing, and reviews belong
    // to the place — so these two deliberately differ.
    expect(mapsUrl(fillmore)).toContain('query=37.7842%2C-122.4332');
    expect(googleReviewsUrl(fillmore)).toContain('query=The%20Fillmore%2C%20San%20Francisco%2C%20CA');
  });

  it('falls back to the name when a venue has no coordinates', () => {
    expect(mapsUrl({ ...fillmore, lat: null, lng: null })).toContain('query=The%20Fillmore');
  });

  it('splits the Yelp query into business and location, as Yelp expects', () => {
    const url = yelpUrl(fillmore);
    expect(url).toContain('find_desc=The%20Fillmore');
    expect(url).toContain('find_loc=San%20Francisco%2C%20CA');
  });

  it('omits an empty Yelp location rather than sending a bare parameter', () => {
    expect(yelpUrl({ name: 'Somewhere' })).toBe('https://www.yelp.com/search?find_desc=Somewhere');
  });

  it('escapes a name that would otherwise break the query', () => {
    const url = googleReviewsUrl({ name: 'Bar & Grill "Live"', city: 'Austin' });
    expect(url).not.toContain('&find');
    expect(url).toContain('%26');
    expect(new URL(url).searchParams.get('query')).toBe('Bar & Grill "Live", Austin');
  });

  it('asks for the official site, so a search does not land on a ticket reseller', () => {
    expect(new URL(websiteSearchUrl(fillmore)).searchParams.get('q')).toBe(
      'The Fillmore, San Francisco, CA official site',
    );
  });

  it('offers nothing for a venue with no name to search on', () => {
    expect(venueLinks({ name: '   ' })).toEqual([]);
  });

  it('produces valid absolute URLs for every link', () => {
    const links = venueLinks(fillmore);
    expect(links).toHaveLength(4);
    for (const l of links) expect(() => new URL(l.url)).not.toThrow();
  });
});
