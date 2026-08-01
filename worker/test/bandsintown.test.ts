import { describe, expect, it } from 'vitest';

import { bitToEventInputs, bitUtc, bitVenueName, type BitArtist } from '../src/sources';
import fixture from './fixtures/bandsintown-events.json';

// Recorded from rest.bandsintown.com (Wednesday, upcoming) so the mapping is
// pinned to a real payload rather than to what we assume one looks like.

const artist: BitArtist = {
  id: 'artist-uuid',
  name: 'Wednesday',
  bandsintown_name: null,
  bandsintown_id: '15495936',
};

describe('bitUtc', () => {
  it('reads a bare datetime as venue-local, not UTC', () => {
    // Storing "20:00Z" showed this San Francisco gig at 1pm. With only a
    // longitude to go on this lands on standard time (-8); given the venue's
    // state it uses the real zone instead — see timezone.test.ts.
    expect(bitUtc('2026-08-06T20:00:00', -122.4194)).toBe('2026-08-07T04:00:00Z');
  });

  it('leaves a timestamp that already carries a zone alone', () => {
    expect(bitUtc('2026-08-06T20:00:00Z', -122.4194)).toBe('2026-08-06T20:00:00Z');
    expect(bitUtc('2026-08-06T20:00:00+02:00', 13.4)).toBe('2026-08-06T18:00:00Z');
  });

  it('returns null for the values the API actually sends for "none"', () => {
    expect(bitUtc('', -122)).toBeNull();
    expect(bitUtc(null, -122)).toBeNull();
    expect(bitUtc('not-a-date', -122)).toBeNull();
  });
});

describe('bitToEventInputs', () => {
  const inputs = bitToEventInputs(artist, fixture as unknown[]);

  it('maps every event in the payload', () => {
    expect(inputs).toHaveLength(fixture.length);
    expect(inputs.every((i) => i.source === 'bandsintown' && i.artist_id === artist.id)).toBe(true);
  });

  it('stores second-precision UTC start times', () => {
    for (const i of inputs) expect(i.starts_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('keeps the lineup, which is what the artist crawl expands from', () => {
    const withLineup = inputs.find((i) => (i.lineup?.length ?? 0) > 1);
    expect(withLineup?.lineup?.[0]).toBe('Wednesday');
    expect(withLineup?.lineup?.every((n) => typeof n === 'string')).toBe(true);
  });

  it('carries venue coordinates, without which a show never reaches the feed', () => {
    for (const i of inputs) {
      expect(i.venue?.source).toBe('bandsintown');
      expect(typeof i.venue?.lat).toBe('number');
      expect(typeof i.venue?.lng).toBe('number');
    }
  });

  it('normalises the flags Bandsintown sends and Ticketmaster does not', () => {
    for (const i of inputs) {
      expect([true, false, null]).toContain(i.sold_out);
      expect([true, false, null]).toContain(i.is_free);
    }
  });

  it('turns an empty ends_at into null rather than an invalid date', () => {
    // The API sends "" for shows with no end time.
    expect(inputs.every((i) => i.ends_at === null || /T\d{2}:\d{2}:\d{2}Z$/.test(i.ends_at!))).toBe(true);
  });

  it('marks a dash-separated billing filed as the venue, using its own context', () => {
    // "MGMT DJ SET - San Francisco" is only tellable from "Fox Theater - Oakland"
    // with the listing's artist and city in hand, so the verdict is made here in
    // the mapping and carried on the row (`junk_name`) for persist to act on.
    const base = fixture[0] as Record<string, unknown>;
    const billing = {
      ...base,
      venue: { ...(base.venue as object), name: 'WEDNESDAY DJ SET - San Francisco', city: 'San Francisco' },
    };
    const [mapped] = bitToEventInputs(artist, [billing]);
    expect(mapped.venue?.junk_name).toBe(true);
    // The real payload's venues are all rooms — none should carry the mark.
    expect(inputs.every((i) => i.venue?.junk_name === undefined)).toBe(true);
  });

  it('repairs a tour-suffixed venue name without rescuing a billing', () => {
    // The room survives its booking...
    expect(bitVenueName('YORK BARBICAN - A Happy Christmas Tour 2026', 'York', 'Aled Jones')).toBe(
      'YORK BARBICAN',
    );
    // ...but a billing is the junk path's case: cleaning "THE WORD ALIVE -
    // ...TOUR" down to the band's name would dress junk up as a room.
    expect(
      bitVenueName('THE WORD ALIVE - THE DECEIVER & DARK MATTER TOUR', 'Detroit', 'The Word Alive'),
    ).toBe('THE WORD ALIVE - THE DECEIVER & DARK MATTER TOUR');
    // A dash-billing keeps its raw name too — junk_name owns it downstream.
    expect(bitVenueName('MGMT DJ SET - San Francisco', 'San Francisco', 'MGMT')).toBe(
      'MGMT DJ SET - San Francisco',
    );
    // Nothing to repair passes through, and a missing name stays the fallback.
    expect(bitVenueName('Bottom of the Hill', 'San Francisco', 'Wednesday')).toBe('Bottom of the Hill');
    expect(bitVenueName(null, 'San Francisco', 'Wednesday')).toBe('Unknown venue');
  });

  it('drops events with an unusable datetime instead of losing the artist', () => {
    const bad = [{ id: '1', datetime: 'not-a-date', venue: {} }, { id: '2', venue: {} }, { datetime: '2026-08-01T20:00:00' }];
    expect(bitToEventInputs(artist, bad)).toHaveLength(0);
  });

  it('falls back to a readable name when the payload has no title', () => {
    const [only] = bitToEventInputs(artist, [
      { id: '9', datetime: '2026-08-01T20:00:00', title: '', venue: { name: 'The Independent', city: 'San Francisco' } },
    ]);
    expect(only.name).toBe('Wednesday @ The Independent');
  });
});
