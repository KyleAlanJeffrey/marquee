import { describe, expect, it } from 'vitest';

import { sgPerformers, sgToEventInputs, sgUtc } from '../src/sources';
import fixture from './fixtures/seatgeek-events.json';

// Recorded from api.seatgeek.com/2/events (San Francisco, 25mi, concerts) so the
// mapping is pinned to a real payload — including a club show with no listings, a
// two-performer bill and a 76-act festival.

/** The resolver `ingestSeatGeek` builds from the database, faked here. */
const idFor = (folded: string) => `artist:${folded}`;

describe('sgUtc', () => {
  it('reads datetime_utc as UTC even though it carries no Z', () => {
    // The trap: `new Date('2026-07-30T02:00:00')` is *local* time, so this show
    // was stored seven hours out in the developer's zone and right in the Worker.
    expect(sgUtc({ datetime_utc: '2026-07-30T02:00:00' })).toBe('2026-07-30T02:00:00Z');
    expect(sgUtc({ datetime_utc: '2026-07-30T02:00:00Z' })).toBe('2026-07-30T02:00:00Z');
  });

  it('falls back to local time plus the venue zone SeatGeek publishes', () => {
    // 19:00 in Los Angeles on July 29 is PDT (-7), so 02:00Z the next day.
    expect(
      sgUtc({ datetime_local: '2026-07-29T19:00:00', venue: { timezone: 'America/Los_Angeles' } }),
    ).toBe('2026-07-30T02:00:00Z');
  });

  it('ignores the Z SeatGeek puts on local fields it does not mean', () => {
    expect(
      sgUtc({ datetime_local: '2026-07-29T19:00:00Z', venue: { timezone: 'America/New_York' } }),
    ).toBe('2026-07-29T23:00:00Z');
  });

  it('returns null rather than an invalid date', () => {
    expect(sgUtc({})).toBeNull();
    expect(sgUtc({ datetime_utc: 'not-a-date' })).toBeNull();
    // A local time with no zone to place it in is unusable, not "assume UTC".
    expect(sgUtc({ datetime_local: '2026-07-29T19:00:00' })).toBeNull();
  });
});

describe('sgPerformers', () => {
  it('puts the primary performer first whatever order they arrive in', () => {
    const names = sgPerformers({
      performers: [
        { name: 'Support Act', primary: false },
        { name: 'The Headliner', primary: true },
      ],
    }).map((p) => p.name);
    expect(names).toEqual(['The Headliner', 'Support Act']);
  });

  it('drops nameless performers and repeats of one name', () => {
    expect(
      sgPerformers({ performers: [{ name: 'A' }, { name: ' a ' }, { name: '' }, { id: 3 }] }),
    ).toEqual([{ name: 'A', imageUrl: null }]);
  });

  it('caps a festival bill instead of storing all 76 acts', () => {
    const festival = fixture.find((e) => (e.performers?.length ?? 0) > 20);
    expect(festival, 'fixture should include the festival').toBeTruthy();
    expect(sgPerformers(festival)).toHaveLength(12);
  });

  it('is empty for an event with no performers, so no show is invented', () => {
    expect(sgPerformers({ performers: [] })).toEqual([]);
    expect(sgPerformers({})).toEqual([]);
  });
});

describe('sgToEventInputs', () => {
  const inputs = sgToEventInputs(fixture as unknown[], idFor);

  it('maps every usable event in the payload', () => {
    const usable = fixture.filter((e) => !e.date_tbd && !e.time_tbd);
    expect(inputs).toHaveLength(usable.length);
    expect(inputs.every((i) => i.source === 'seatgeek')).toBe(true);
  });

  it('stores second-precision UTC start times', () => {
    for (const i of inputs) expect(i.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('keys the show on the headliner, not on whoever came first in the array', () => {
    const kim = inputs.find((i) => i.name.startsWith('Kim Gordon'));
    expect(kim?.artist_id).toBe('artist:kim gordon');
  });

  it('carries the venue with its real coordinates', () => {
    const club = inputs.find((i) => i.venue?.name === 'Kilowatt Bar');
    expect(club?.venue).toMatchObject({ source: 'seatgeek', city: 'San Francisco', region: 'CA', country: 'US' });
    expect(club?.venue?.lat).toBeCloseTo(37.765, 2);
    expect(club?.venue?.lng).toBeCloseTo(-122.423, 2);
  });

  it('treats "no listings" as no price rather than free', () => {
    // stats.lowest_price is null and median_price 0 when nothing is for sale;
    // storing 0 would advertise a paid club show as free.
    const club = inputs.find((i) => i.venue?.name === 'Kilowatt Bar');
    expect(club?.price_from).toBeNull();
    expect(club?.is_free).toBeUndefined();
    const priced = inputs.find((i) => i.name === 'ENHYPEN');
    expect(priced?.price_from).toBe(60);
  });

  it('records a lineup only when there is a support act to record', () => {
    const solo = inputs.find((i) => i.venue?.name === 'Kilowatt Bar');
    expect(solo?.lineup).toBeNull();
    const bill = inputs.find((i) => i.name.startsWith('Kim Gordon'));
    expect(bill?.lineup?.[0]).toBe('Kim Gordon');
    expect(bill?.lineup?.length).toBeGreaterThan(1);
  });

  it('ignores enddatetime_utc, which is a template rather than a fact', () => {
    // Every event in the recorded page ends exactly 90 or 60 minutes after it
    // starts. Storing that would print a made-up end time on every show — and
    // fill the field on merged Ticketmaster rows that are honestly empty.
    for (const i of inputs) expect(i.ends_at ?? null).toBeNull();
    const club = fixture.find((e) => e.venue?.name === 'Kilowatt Bar');
    expect(club?.enddatetime_utc, 'the payload does carry one').toBeTruthy();
  });

  it('skips an event whose artist did not resolve, instead of a null id', () => {
    expect(sgToEventInputs(fixture as unknown[], () => undefined)).toEqual([]);
  });

  it('skips an unannounced set time rather than storing SeatGeek\'s 03:30', () => {
    // The one time_tbd event in the recorded page is a three-day festival pass
    // with a local start of 03:30 — a placeholder, not a doors time. Since
    // SeatGeek co-owns starts_at, keeping it could also overwrite a real
    // Ticketmaster time for the same show.
    const tbd = fixture.find((e) => e.time_tbd === true);
    expect(tbd, 'fixture should include a time_tbd event').toBeTruthy();
    expect(tbd?.datetime_local).toContain('T03:30');
    expect(inputs.some((i) => i.source_event_id === String(tbd?.id))).toBe(false);
  });

  it('skips events with no usable date', () => {
    const first = fixture[0];
    expect(sgToEventInputs([{ ...first, date_tbd: true }], idFor)).toEqual([]);
    expect(sgToEventInputs([{ ...first, datetime_utc: null, datetime_local: null }], idFor)).toEqual([]);
    expect(sgToEventInputs([{ ...first, id: null }], idFor)).toEqual([]);
  });
});
