import { describe, expect, it } from 'vitest';

import {
  bestVenueMatch,
  guessUtcOffsetHours,
  mergeField,
  metersBetween,
  parseSources,
  prefersSource,
  sameShow,
  sameVenue,
  venueNamesAgree,
  venueNamesMatchStrongly,
  type VenuePoint,
} from '../src/dedupe';

const at = (name: string, lat: number, lng: number, city?: string, id = name): VenuePoint => ({
  id,
  name,
  lat,
  lng,
  city,
});

describe('venue identity', () => {
  it('measures real distances', () => {
    // The Fillmore to Great American Music Hall, ~1.3km apart in SF.
    const m = metersBetween({ lat: 37.7842, lng: -122.4332 }, { lat: 37.7849, lng: -122.4187 });
    expect(m).toBeGreaterThan(1_200);
    expect(m).toBeLessThan(1_400);
  });

  it('matches the same room at the same coordinates whatever it is called', () => {
    expect(sameVenue(at('The Independent', 37.7756, -122.4376), at('Independent SF', 37.7756, -122.4376))).toBe(true);
  });

  it('separates two different rooms on the same block', () => {
    // ~150m apart, no shared distinguishing word.
    expect(sameVenue(at('Bottom of the Hill', 37.7654, -122.3961), at('Thee Parkside', 37.7667, -122.3961))).toBe(false);
  });

  // Measured pairs where Ticketmaster's coordinates sit on the city, not the door.
  it.each([
    ['Franklin Music Hall', 'Franklin Music Hall', 39.9589, -75.15, 39.9662, -75.1443, 'Philadelphia'],
    ['Royal Oak Music Theatre', 'Royal Oak Music Theatre', 42.4877, -83.1475, 42.4934, -83.1441, 'Royal Oak'],
    ['The Eastern-GA', 'The Eastern', 33.7452, -84.3606, 33.7501, -84.3123, 'Atlanta'],
    ['Agora Theatre', 'Agora Theater & Ballroom', 41.5037, -81.654, 41.4993, -81.6549, 'Cleveland'],
  ])('joins "%s" and "%s" across a city-centroid coordinate', (n1, n2, la1, ln1, la2, ln2, city) => {
    expect(sameVenue(at(n1, la1, ln1, city, '1'), at(n2, la2, ln2, city, '2'))).toBe(true);
  });

  it('will not join look-alike names in different towns', () => {
    expect(
      sameVenue(at('The Fillmore', 37.7842, -122.4332, 'San Francisco'), at('The Fillmore', 38.9907, -77.0261, 'Silver Spring')),
    ).toBe(false);
  });

  it('will not join two rooms whose names merely share a word', () => {
    expect(sameVenue(at('Brooklyn Bowl', 40.7219, -73.9575, 'Brooklyn'), at('Brooklyn Steel', 40.7126, -73.9366, 'Brooklyn'))).toBe(
      false,
    );
  });

  it('needs coordinates on both sides', () => {
    expect(sameVenue(at('Somewhere', 1, 1), { id: 'x', name: 'Somewhere', lat: null, lng: null })).toBe(false);
  });

  it('picks the nearest of several candidates', () => {
    const target = at('The Independent', 37.7756, -122.4376, 'San Francisco', 'target');
    const best = bestVenueMatch(target, [
      at('The Independent', 37.78, -122.44, 'San Francisco', 'far'),
      at('The Independent', 37.7757, -122.4377, 'San Francisco', 'near'),
    ]);
    expect(best?.id).toBe('near');
  });

  it('ignores generic words when comparing names', () => {
    expect(venueNamesAgree('The Music Hall', 'Music Hall Theatre')).toBe(true); // nothing to go on
    expect(venueNamesMatchStrongly('The Music Hall', 'Music Hall Theatre')).toBe(false); // …so not strong
    expect(venueNamesMatchStrongly('Roadrunner', 'Roadrunner-Boston')).toBe(true);
  });
});

describe('show identity', () => {
  const base = { artistId: 'a1', venueId: 'v1', startsAt: '2026-08-06T03:00:00Z' };

  it('joins listings hours apart at one venue', () => {
    // Ticketmaster in UTC vs Bandsintown local-ish for the same San Francisco gig.
    expect(sameShow(base, { ...base, startsAt: '2026-08-05T23:30:00Z' })).toBe(true);
  });

  it('keeps a two-night run as two shows', () => {
    expect(sameShow(base, { ...base, startsAt: '2026-08-07T03:00:00Z' })).toBe(false);
  });

  it('needs the same artist and a known venue', () => {
    expect(sameShow(base, { ...base, artistId: 'a2' })).toBe(false);
    expect(sameShow({ ...base, venueId: null }, { ...base, venueId: null })).toBe(false);
  });
});

describe('field ownership', () => {
  it('lets Ticketmaster own price and time, Bandsintown own the lineup', () => {
    expect(prefersSource('price_from', 'ticketmaster', 'bandsintown')).toBe(true);
    expect(prefersSource('price_from', 'bandsintown', 'ticketmaster')).toBe(false);
    expect(prefersSource('starts_at', 'bandsintown', 'ticketmaster')).toBe(false);
    expect(prefersSource('lineup', 'bandsintown', 'ticketmaster')).toBe(true);
  });

  it('lets a source correct itself', () => {
    expect(prefersSource('price_from', 'bandsintown', 'bandsintown')).toBe(true);
  });

  it('fills an empty field regardless of ownership', () => {
    expect(mergeField('price_from', 42, null, 'bandsintown', 'ticketmaster')).toBe(42);
    expect(mergeField('sold_out', null, true, 'ticketmaster', 'bandsintown')).toBe(true);
  });

  it('keeps the owner value in a contest', () => {
    expect(mergeField('price_from', 99, 42, 'bandsintown', 'ticketmaster')).toBe(42);
    expect(mergeField('sold_out', true, false, 'bandsintown', 'ticketmaster')).toBe(true);
  });
});

describe('timezone guess', () => {
  it.each([
    [-122.4, -8], // San Francisco
    [-74, -5], // New York
    [0, 0], // London
    [13.4, 1], // Berlin
    [139.7, 9], // Tokyo
  ])('maps longitude %s to offset %s', (lng, expected) => {
    expect(guessUtcOffsetHours(lng)).toBe(expected);
  });

  it('falls back to UTC without a longitude', () => {
    expect(guessUtcOffsetHours(null)).toBe(0);
    expect(guessUtcOffsetHours(Number.NaN)).toBe(0);
  });
});

describe('parseSources', () => {
  it('survives anything the column might hold', () => {
    expect(parseSources(null)).toEqual({});
    expect(parseSources('not json')).toEqual({});
    expect(parseSources('[1,2]')).toEqual({});
    expect(parseSources('{"ticketmaster":"abc"}')).toEqual({ ticketmaster: 'abc' });
  });
});
