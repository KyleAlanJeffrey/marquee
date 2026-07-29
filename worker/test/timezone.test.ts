import { describe, expect, it } from 'vitest';

import { bitUtc } from '../src/sources';
import { utcMsFromLocal, zoneFor, zoneOffsetMinutes } from '../src/timezone';

describe('zoneFor', () => {
  it('maps a state or province code to its zone', () => {
    expect(zoneFor('CA', 'US')).toBe('America/Los_Angeles');
    expect(zoneFor('ny', 'United States')).toBe('America/New_York');
    expect(zoneFor('ON', 'Canada')).toBe('America/Toronto');
    // Arizona does not observe daylight saving, and its own zone encodes that.
    expect(zoneFor('AZ', 'US')).toBe('America/Phoenix');
  });

  it('declines anywhere the code is not a state', () => {
    // Bandsintown sends region: "" outside North America, and a two-letter
    // European region would collide with a state code.
    expect(zoneFor('', 'Italy')).toBeNull();
    expect(zoneFor('CA', 'Italy')).toBeNull();
    expect(zoneFor(null, 'US')).toBeNull();
    expect(zoneFor('ZZ', 'US')).toBeNull();
  });
});

describe('zoneOffsetMinutes', () => {
  it('reports the offset in force on the day, not a fixed one', () => {
    const july = Date.parse('2026-07-15T12:00:00Z');
    const january = Date.parse('2026-01-15T12:00:00Z');
    expect(zoneOffsetMinutes('America/Los_Angeles', july)).toBe(-420); // PDT
    expect(zoneOffsetMinutes('America/Los_Angeles', january)).toBe(-480); // PST
    expect(zoneOffsetMinutes('America/Phoenix', july)).toBe(-420); // no DST
    expect(zoneOffsetMinutes('UTC', july)).toBe(0);
  });

  it('handles a half-hour zone, which a longitude guess cannot', () => {
    expect(zoneOffsetMinutes('Asia/Kolkata', Date.parse('2026-07-15T12:00:00Z'))).toBe(330);
  });

  it('returns null for a zone it does not know', () => {
    expect(zoneOffsetMinutes('Mars/Olympus', Date.now())).toBeNull();
  });
});

describe('utcMsFromLocal', () => {
  it('converts a wall clock to the right instant on both sides of a DST change', () => {
    const summer = utcMsFromLocal(Date.UTC(2026, 7, 6, 20, 0), 'America/Los_Angeles');
    expect(new Date(summer!).toISOString()).toBe('2026-08-07T03:00:00.000Z');
    const winter = utcMsFromLocal(Date.UTC(2026, 0, 6, 20, 0), 'America/Los_Angeles');
    expect(new Date(winter!).toISOString()).toBe('2026-01-07T04:00:00.000Z');
  });
});

describe('bitUtc with a venue', () => {
  it('uses the venue zone, so a summer show is not an hour late', () => {
    // The longitude-only guess stored this as 04:00Z — 8pm PST in a month that is
    // PDT — which put the show an hour off in the feed and in reminders.
    expect(bitUtc('2026-08-06T20:00:00', { lng: -122.4194, region: 'CA', country: 'US' })).toBe(
      '2026-08-07T03:00:00Z',
    );
    expect(bitUtc('2026-01-06T20:00:00', { lng: -122.4194, region: 'CA', country: 'US' })).toBe(
      '2026-01-07T04:00:00Z',
    );
  });

  it('falls back to longitude where no zone can be named', () => {
    // Castelbuono, Italy — a real venue from the recorded payload.
    expect(bitUtc('2026-08-06T16:30:00', { lng: 14.0886407, region: '', country: 'Italy' })).toBe(
      '2026-08-06T15:30:00Z',
    );
  });

  it('still accepts a bare longitude, and a timestamp that carries its own zone', () => {
    expect(bitUtc('2026-08-06T20:00:00', -122.4194)).toBe('2026-08-07T04:00:00Z');
    expect(bitUtc('2026-08-06T20:00:00Z', { lng: -122.4194, region: 'CA', country: 'US' })).toBe(
      '2026-08-06T20:00:00Z',
    );
  });
});
