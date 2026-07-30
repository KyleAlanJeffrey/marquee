import { describe, expect, it } from 'vitest';

import { KEY_SHAPE, unannounced } from '../src/indexnow';

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
  // IndexNow refused every cron run with 429 "potential Spam" while accepting a
  // one-off POST of 200 never-submitted URLs from the same host and key. The
  // difference was that each run re-sent `/` and every affected hub.
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

  it('keeps the order it was given, so hubs stay ahead of events in the payload', () => {
    const candidates = ['/', '/concerts/a', '/concerts/b', '/concerts/c'];
    expect(unannounced(candidates, new Set(['/concerts/b']))).toEqual([
      '/',
      '/concerts/a',
      '/concerts/c',
    ]);
  });
});
