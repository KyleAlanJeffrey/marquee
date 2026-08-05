import { describe, expect, it } from 'vitest';

import { dicePerformers, dicePrice, diceRegion, diceToEventInputs, diceUtc } from '../src/sources';
import fixture from './fixtures/dice-events.json';

// Recorded from api.dice.fm/unified_search (New York, "knockdown center") so the
// mapping is pinned to a real payload — a five-act bill with a from-price, a
// sold-out show, a club night billed with no artists at all, and a listing whose
// price lives under `amount` instead of `amount_from`.

/** The resolver `ingestDice` builds from the database, faked here. */
const idFor = (folded: string) => `artist:${folded}`;

describe('diceUtc', () => {
  it('converts the offset-carrying start to UTC', () => {
    // 18:30 in New York on August 13 is EDT (-4), so 22:30Z.
    expect(diceUtc(fixture[0])).toBe('2026-08-13T22:30:00Z');
  });

  it('falls back to the epoch when the ISO field is missing or broken', () => {
    expect(diceUtc({ date_unix: 1786215600 })).toBe('2026-08-08T19:00:00Z');
    expect(diceUtc({ dates: { event_start_date: 'not-a-date' }, date_unix: 1786215600 })).toBe(
      '2026-08-08T19:00:00Z',
    );
  });

  it('returns null rather than an invalid date', () => {
    expect(diceUtc({})).toBeNull();
    expect(diceUtc({ date_unix: 0 })).toBeNull();
  });
});

describe('diceRegion', () => {
  it('reads the state out of a US address', () => {
    expect(diceRegion('52-19 Flushing Ave, Maspeth, NY 11378, USA')).toBe('NY');
    expect(diceRegion('1234 Main St, Springfield, MO 65801-1234, USA')).toBe('MO');
  });

  it('answers null for addresses without a state-and-zip', () => {
    expect(diceRegion('186 Hackney Rd, London E2 7QL, UK')).toBeNull();
    expect(diceRegion(null)).toBeNull();
  });
});

describe('dicePrice', () => {
  it('converts integer cents to dollars, from either price field', () => {
    expect(dicePrice(fixture[0])).toBe(30.44); // amount_from
    expect(dicePrice(fixture[3])).toBe(38.17); // amount, no amount_from
  });

  it('refuses non-USD prices — the column carries no currency', () => {
    expect(dicePrice({ price: { currency: 'EUR', amount_from: 3000 } })).toBeNull();
    expect(dicePrice({ price: { currency: 'USD', amount_from: 0 } })).toBeNull();
    expect(dicePrice({})).toBeNull();
  });
});

describe('dicePerformers', () => {
  it('keeps the payload order and dedupes case-insensitively', () => {
    const names = dicePerformers(fixture[0]).map((p) => p.name);
    expect(names[0]).toBe('clipping.');
    expect(names).toContain('SPELLLING');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });

  it('preserves order and removes case-variant duplicates', () => {
    const e = {
      summary_lineup: {
        top_artists: [{ name: 'Opener' }, { name: 'The Star' }, { name: 'opener' }],
      },
    };
    expect(dicePerformers(e).map((p) => p.name)).toEqual(['Opener', 'The Star']);
  });

  it('puts a marked headliner first', () => {
    const e = {
      summary_lineup: {
        top_artists: [{ name: 'Opener' }, { name: 'The Star', is_headliner: true }],
      },
    };
    expect(dicePerformers(e).map((p) => p.name)).toEqual(['The Star', 'Opener']);
  });
});

describe('diceToEventInputs', () => {
  const inputs = diceToEventInputs(fixture as any[], idFor);

  it('maps the recorded payload, skipping the artist-less club night', () => {
    // Four recorded events, one billed with no artists at all.
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.name)).not.toContain('Horse Meat Disco NY Labor Day Weekend');
  });

  it('builds the full row for a normal show', () => {
    const e = inputs[0];
    expect(e.source).toBe('dice');
    expect(e.source_event_id).toBe(fixture[0].id);
    expect(e.starts_at).toBe('2026-08-13T22:30:00Z');
    expect(e.ticket_url).toBe(`https://dice.fm/event/${fixture[0].perm_name}`);
    expect(e.price_from).toBe(30.44);
    expect(e.artist_id).toBe('artist:clipping.');
    expect(e.lineup?.length).toBeGreaterThan(1);
    expect(e.venue).toMatchObject({
      source: 'dice',
      source_venue_id: '2421',
      name: 'Knockdown Center',
      city: 'New York',
      region: 'NY',
      country: 'US',
    });
    expect(e.venue?.lat).toBeCloseTo(40.715, 2);
  });

  it('flags a sold-out show and leaves the rest unknown', () => {
    const sold = inputs.find((i) => i.name.startsWith('SG Lewis'));
    expect(sold?.sold_out).toBe(true);
    expect(inputs[0].sold_out).toBeNull();
  });

  it('drops events the headliner resolver cannot place', () => {
    expect(diceToEventInputs(fixture as any[], () => undefined)).toHaveLength(0);
  });
});
