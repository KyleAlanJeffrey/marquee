import { describe, expect, it } from 'vitest';

import { bitToEventInputs, type BitArtist } from '../src/sources';
import fixture from './fixtures/bandsintown-events.json';

// Recorded from rest.bandsintown.com (Wednesday, upcoming) so the mapping is
// pinned to a real payload rather than to what we assume one looks like.

const artist: BitArtist = {
  id: 'artist-uuid',
  name: 'Wednesday',
  bandsintown_name: null,
  bandsintown_id: '15495936',
};

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
