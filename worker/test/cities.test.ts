import { describe, expect, it } from 'vitest';

import { citySlug, foldCountries, mergeBySlug, townBySlug, type Row, type Town } from '../src/cities';

const row = (over: Partial<Row>): Row => ({
  city: 'Austin',
  region: 'TX',
  country: 'United States',
  lat: 30.27,
  lng: -97.74,
  upcoming: 10,
  venues: 3,
  ...over,
});

const town = (over: Partial<Town> = {}): Town => {
  const base: Town = {
    city: 'Austin',
    region: 'TX',
    country: 'United States',
    slug: 'austin-tx',
    label: 'Austin, TX',
    lat: 30.27,
    lng: -97.74,
    upcoming: 10,
    venues: 3,
    cities: ['austin'],
    regions: ['tx'],
    aliases: ['austin-tx'],
    ...over,
  };
  // Keep the fixture self-consistent unless a test says otherwise.
  return {
    ...base,
    cities: over.cities ?? [base.city.toLowerCase()],
    regions: over.regions ?? [(base.region ?? '').toLowerCase()],
    aliases: over.aliases ?? (base.slug ? [base.slug] : []),
  };
};

describe('city slugs', () => {
  it('qualifies with the region when there is one', () => {
    expect(citySlug('Austin', 'TX', 'United States')).toBe('austin-tx');
  });

  it('falls back to the country when there is no region', () => {
    expect(citySlug('London', null, 'United Kingdom')).toBe('london-united-kingdom');
    expect(citySlug('Paris', '', 'France')).toBe('paris-france');
  });

  it('keeps same-named towns apart', () => {
    expect(citySlug('Portland', 'OR', 'United States')).not.toBe(
      citySlug('Portland', 'ME', 'United States'),
    );
  });

  it('strips accents so one town is one URL', () => {
    expect(citySlug('München', null, 'Germany')).toBe('munchen-germany');
    expect(citySlug('Malmö', null, 'Sweden')).toBe('malmo-sweden');
  });

  it('collapses punctuation rather than encoding it', () => {
    expect(citySlug('St. Louis', 'MO', 'United States')).toBe('st-louis-mo');
    expect(citySlug("Coeur d'Alene", 'ID', 'United States')).toBe('coeur-d-alene-id');
  });

  it('is empty for a name with no Latin characters, so callers can skip it', () => {
    // Never `-japan` or `japan`: a slug that names the country instead of the city
    // would be one URL for every such town in it.
    expect(citySlug('東京', null, 'Japan')).toBe('');
    expect(citySlug('Мурманск', null, 'Russia')).toBe('');
    expect(citySlug('東京', null, null)).toBe('');
  });
});

describe('folding country spellings into one town', () => {
  it('merges two spellings of the same country and keeps the busier one', () => {
    const [london] = foldCountries([
      row({ city: 'London', region: '', country: 'United Kingdom', upcoming: 172, venues: 30 }),
      row({ city: 'London', region: '', country: 'GB', upcoming: 124, venues: 17 }),
    ]);
    expect(london.country).toBe('United Kingdom');
    expect(london.slug).toBe('london-united-kingdom');
    // Totals cover both spellings, not just the winner's.
    expect(london.upcoming).toBe(296);
    expect(london.venues).toBe(47);
    // The losing spelling's URL is already published; it has to keep resolving.
    expect(london.aliases.sort()).toEqual(['london-gb', 'london-united-kingdom']);
  });

  it('does not care what order the spellings arrive in', () => {
    const asc = foldCountries([
      row({ city: 'London', region: '', country: 'GB', upcoming: 124 }),
      row({ city: 'London', region: '', country: 'United Kingdom', upcoming: 172 }),
    ]);
    expect(asc[0].country).toBe('United Kingdom');
  });

  it('keeps genuinely different places apart when the region differs', () => {
    const towns = foldCountries([
      row({ city: 'London', region: '', country: 'United Kingdom', upcoming: 172 }),
      row({ city: 'London', region: 'ON', country: 'Canada', upcoming: 8 }),
      row({ city: 'London', region: 'KY', country: 'United States', upcoming: 1 }),
    ]);
    expect(towns.map((t) => t.slug)).toEqual(['london-united-kingdom', 'london-on', 'london-ky']);
  });

  it('takes the centroid from the winning spelling, not the last row read', () => {
    const [t] = foldCountries([
      row({ city: 'Austin', region: 'TX', country: 'US', upcoming: 2, lat: 0, lng: 0 }),
      row({ city: 'Austin', region: 'TX', country: 'United States', upcoming: 193, lat: 30.27, lng: -97.74 }),
    ]);
    expect(t.lat).toBeCloseTo(30.27);
    expect(t.lng).toBeCloseTo(-97.74);
  });

  it('sorts busiest first', () => {
    const towns = foldCountries([
      row({ city: 'Reno', region: 'NV', upcoming: 5 }),
      row({ city: 'Austin', region: 'TX', upcoming: 190 }),
    ]);
    expect(towns.map((t) => t.city)).toEqual(['Austin', 'Reno']);
  });

  it('drops a row with no city rather than inventing one', () => {
    expect(foldCountries([row({ city: null })])).toEqual([]);
  });
});

describe('one town per slug', () => {
  it('drops towns that slugify to nothing', () => {
    const kept = mergeBySlug([town({ city: '東京', region: null, country: null, slug: '' }), town()]);
    expect(kept.map((t) => t.slug)).toEqual(['austin-tx']);
  });

  it('merges two spellings of one city instead of dropping one', () => {
    const [merged] = mergeBySlug([
      town({ city: 'Montréal', slug: 'montreal-qc', region: 'QC', label: 'Montréal, QC', upcoming: 40, venues: 9 }),
      town({ city: 'Montreal', slug: 'montreal-qc', region: 'QC', label: 'Montreal, QC', upcoming: 26, venues: 6 }),
    ]);
    expect(merged.upcoming).toBe(66);
    expect(merged.venues).toBe(15);
    // Both spellings have to reach the query, or one spelling's shows go missing.
    expect(merged.cities.sort()).toEqual(['montreal', 'montréal']);
    // Busiest keeps the label.
    expect(merged.label).toBe('Montréal, QC');
  });

  it('merges region spellings too', () => {
    const [merged] = mergeBySlug([
      town({ city: 'Basel', region: 'Basel-Stadt', slug: 'basel-basel-stadt', upcoming: 5 }),
      town({ city: 'Basel', region: 'Basel Stadt', slug: 'basel-basel-stadt', upcoming: 3 }),
    ]);
    expect(merged.regions.sort()).toEqual(['basel stadt', 'basel-stadt']);
  });

  it('re-sorts, because merging changes the totals', () => {
    const towns = mergeBySlug([
      town({ city: 'Austin', slug: 'austin-tx', upcoming: 50 }),
      town({ city: 'St. Louis', region: 'MO', slug: 'st-louis-mo', upcoming: 40 }),
      town({ city: 'St Louis', region: 'MO', slug: 'st-louis-mo', upcoming: 30 }),
    ]);
    expect(towns.map((t) => [t.slug, t.upcoming])).toEqual([
      ['st-louis-mo', 70],
      ['austin-tx', 50],
    ]);
  });

  it('does not mutate the towns it was given', () => {
    const a = town({ city: 'Zurich', region: null, country: 'Switzerland', slug: 'zurich-switzerland', upcoming: 9 });
    const b = town({ city: 'Zürich', region: null, country: 'Switzerland', slug: 'zurich-switzerland', upcoming: 4 });
    mergeBySlug([a, b]);
    expect(a.upcoming).toBe(9);
    expect(a.cities).toEqual(['zurich']);
  });
});

describe('resolving a slug back to a town', () => {
  const towns = [
    town(),
    town({
      city: 'London',
      region: null,
      country: 'United Kingdom',
      slug: 'london-united-kingdom',
      aliases: ['london-united-kingdom', 'london-gb'],
    }),
  ];

  it('finds a town by its slug', () => {
    expect(townBySlug(towns, 'austin-tx')?.city).toBe('Austin');
  });

  it('normalises what it is given, so a stray capital or slash still resolves', () => {
    expect(townBySlug(towns, 'Austin-TX')?.city).toBe('Austin');
    expect(townBySlug(towns, 'austin_tx')?.city).toBe('Austin');
  });

  it('answers to a spelling it no longer publishes', () => {
    const found = townBySlug(towns, 'london-gb');
    // Found, but under a different slug — which is what tells the route to redirect.
    expect(found?.slug).toBe('london-united-kingdom');
  });

  it('never lets one town’s old spelling outrank another town’s real URL', () => {
    const shadowed = [
      town({ city: 'Reno', region: 'NV', slug: 'reno-nv', aliases: ['reno-nv', 'austin-tx'] }),
      town(),
    ];
    expect(townBySlug(shadowed, 'austin-tx')?.city).toBe('Austin');
  });

  it('returns null for a slug no town answers to', () => {
    expect(townBySlug(towns, 'atlantis')).toBeNull();
    expect(townBySlug(towns, '')).toBeNull();
    // The empty-slug towns were filtered out, so this must not match one.
    expect(townBySlug(towns, '---')).toBeNull();
  });
});
