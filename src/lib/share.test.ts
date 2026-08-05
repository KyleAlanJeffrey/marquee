import { describe, expect, it } from 'vitest';

import { eventShare } from './share-payload';

describe('eventShare', () => {
  it('builds the canonical URL and a what/where/when message', () => {
    const p = eventShare({
      id: 'abc-123',
      name: 'Kesha: The Freedom Tour',
      venueName: 'Germania Insurance Amphitheater',
      venueCity: 'Austin',
      when: 'Sun, Aug 9',
    });
    expect(p.url).toBe('https://marquee.rocks/event/abc-123');
    expect(p.title).toBe('Kesha: The Freedom Tour');
    expect(p.message).toBe(
      'Kesha: The Freedom Tour · Germania Insurance Amphitheater, Austin · Sun, Aug 9',
    );
  });

  it('drops the venue clause when there is no venue to name', () => {
    const p = eventShare({ id: 'x', name: 'Secret Show', when: 'Tonight' });
    expect(p.message).toBe('Secret Show · Tonight');
  });

  it('URL-encodes an id rather than trusting it', () => {
    expect(eventShare({ id: 'a/b?c', name: 'X', when: 'Y' }).url).toBe(
      'https://marquee.rocks/event/a%2Fb%3Fc',
    );
  });
});
