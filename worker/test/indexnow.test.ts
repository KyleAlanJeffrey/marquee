import { describe, expect, it } from 'vitest';

import { KEY_SHAPE, recordsOn, unannounced } from '../src/indexnow';

describe('the key a crawler fetches back', () => {
  it('accepts the shapes the .txt route serves', () => {
    for (const key of ['c404e10144068652cb1b7816ce85568b', 'a'.repeat(8), 'A-9'.repeat(10)]) {
      expect(KEY_SHAPE.test(key), key).toBe(true);
    }
  });

  it('rejects anything that would make the key file a different URL', () => {
    // A key with a slash or a dot in it doesn't round-trip through `/<key>.txt`.
    for (const key of ['short', 'a'.repeat(129), 'has/slash', 'has.dot', 'has space', '']) {
      expect(KEY_SHAPE.test(key), key).toBe(false);
    }
  });
});

describe('holding back listing pages we just announced', () => {
  // Kept because a crawler does not need telling 96 times a day that a page changed —
  // not because it fixes the 429s, which measurement traced to the request's origin
  // rather than its contents. See the note on `LISTING_TTL_HOURS`.
  it('drops the ones inside the TTL and keeps the rest', () => {
    const candidates = ['/', '/concerts/austin-tx', '/concerts/london-united-kingdom'];
    const announced = new Set(['/', '/concerts/austin-tx']);
    expect(unannounced(candidates, announced)).toEqual(['/concerts/london-united-kingdom']);
  });

  it('submits everything on the first run, when nothing has been announced', () => {
    const candidates = ['/', '/concerts/austin-tx'];
    expect(unannounced(candidates, new Set())).toEqual(candidates);
  });

  it('can hold back the whole listing set — the event URLs are the point', () => {
    const candidates = ['/', '/concerts/austin-tx'];
    expect(unannounced(candidates, new Set(candidates))).toEqual([]);
  });

  it('backs off on 429, or the throttle can never engage', () => {
    // The deadlock this replaces: recording only successes meant that while the endpoint
    // refused us, nothing was written, nothing was skipped, and the same listings went
    // out every run. Production showed `skipped: 0, status: 429` on consecutive runs,
    // then `skipped: 27` once fixed.
    expect(recordsOn(429)).toBe(true);
    // Bing returns 202 for "accepted, key validation pending" — not in its own table.
    for (const ok of [200, 202, 204]) expect(recordsOn(ok), String(ok)).toBe(true);
  });

  it('retries rather than backs off when the fault is ours', () => {
    // 403 is a rejected key and 422 a host mismatch: fix the cause, don't go quiet.
    for (const bad of [400, 403, 422, 500, 503]) expect(recordsOn(bad), String(bad)).toBe(false);
  });

  it('keeps the order it was given, so hubs stay ahead of events in the payload', () => {
    const candidates = ['/', '/concerts/a', '/concerts/b', '/concerts/c'];
    expect(unannounced(candidates, new Set(['/concerts/b']))).toEqual([
      '/',
      '/concerts/a',
      '/concerts/c',
    ]);
  });
});
