import { describe, expect, it } from 'vitest';

import { artistBody, eventBody, venueBody, type ArtistBody, type EventBody, type VenueBody } from '../src/detail';

const ev = (over: Partial<EventBody> = {}): EventBody => ({
  id: 'e1',
  name: 'Wolf Alice at Brixton Academy',
  startsAt: '2026-08-02T19:00:00Z',
  zone: 'Europe/London',
  ticketUrl: 'https://tickets.example/e1',
  priceFrom: 42,
  artistId: 'a1',
  artistName: 'Wolf Alice',
  venueId: 'v1',
  venueName: 'Brixton Academy',
  city: 'London',
  region: null,
  country: 'United Kingdom',
  alsoPlaying: [],
  ...over,
});

const ar = (over: Partial<ArtistBody> = {}): ArtistBody => ({
  id: 'a1',
  name: 'Wolf Alice',
  genres: ['rock'],
  shows: [],
  truncated: false,
  ...over,
});

const ve = (over: Partial<VenueBody> = {}): VenueBody => ({
  id: 'v1',
  name: 'Brixton Academy',
  city: 'London',
  region: null,
  country: 'United Kingdom',
  upcoming: 0,
  shows: [],
  truncated: false,
  ...over,
});

describe('the event page a crawler sees', () => {
  it('says what the show is, and links the parts of it', () => {
    const html = eventBody(ev());
    expect(html).toContain('<h1>Wolf Alice at Brixton Academy</h1>');
    expect(html).toContain('href="/artist/a1"');
    expect(html).toContain('href="/venue/v1"');
    expect(html).toContain('href="/concerts/london-united-kingdom"');
    expect(html).toContain('Get tickets');
  });

  it('renders the date in the venue’s timezone, not UTC', () => {
    // 00:30 UTC on the 3rd is still the 2nd in Los Angeles.
    const html = eventBody(ev({ startsAt: '2026-08-03T00:30:00Z', zone: 'America/Los_Angeles' }));
    expect(html).toContain('Sun, Aug 2');
  });

  it('does not name the venue twice when the venue is the festival', () => {
    const html = eventBody(ev({ name: 'Kendal Calling 2026', venueName: 'Kendal Calling 2026', city: 'Lowther' }));
    expect(html).toContain('plays in Lowther on');
    // Still linked in the facts list — it is a real venue page.
    expect(html).toContain('href="/venue/v1"');
  });

  it('refuses a ticket link that is not http(s)', () => {
    // These come from third-party feeds and end up in an href someone clicks.
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', ' javascript:alert(1)']) {
      const html = eventBody(ev({ ticketUrl: url }));
      expect(html).not.toContain('Get tickets');
      expect(html).not.toContain('javascript:');
    }
  });

  it('escapes names that contain markup', () => {
    const html = eventBody(ev({ artistName: '<script>alert(1)</script>', name: 'A & B "live"' }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('leaves out what it does not know', () => {
    const html = eventBody(ev({ venueId: null, venueName: null, city: null, ticketUrl: null, priceFrom: null }));
    expect(html).not.toContain('href="/venue/');
    expect(html).not.toContain('Get tickets');
    expect(html).not.toContain('<dt>From</dt>');
    expect(html).toContain('plays live on');
  });

  it('lists the rest of the tour, each date in its own timezone', () => {
    const html = eventBody(
      ev({
        alsoPlaying: [
          { id: 'e2', startsAt: '2026-08-06T02:00:00Z', zone: 'Asia/Manila', venueName: 'Mega Star', city: 'Pasay', region: null },
        ],
      }),
    );
    expect(html).toContain('href="/event/e2"');
    // 02:00 UTC is already the 6th in Manila; in London it is still the 6th too, so
    // use the venue: Mega Star's local day is what a reader in Pasay expects.
    expect(html).toContain('Thu, Aug 6');
    expect(html).toContain('Mega Star, Pasay');
  });
});

describe('the artist page a crawler sees', () => {
  it('is a tour-date list of real links', () => {
    const html = artistBody(
      ar({
        shows: [
          { id: 'e1', startsAt: '2026-08-02T19:00:00Z', zone: 'Europe/London', venueId: 'v1', venueName: 'Brixton Academy', city: 'London', region: null, country: 'United Kingdom' },
          { id: 'e2', startsAt: '2026-09-04T19:00:00Z', zone: 'America/Chicago', venueId: 'v2', venueName: 'The Salt Shed', city: 'Chicago', region: 'IL', country: 'United States' },
        ],
      }),
    );
    expect(html).toContain('<h1>Wolf Alice tour dates</h1>');
    expect(html).toContain('href="/event/e1"');
    expect(html).toContain('href="/event/e2"');
    expect(html).toContain('Brixton Academy, London');
    expect(html).toContain('The Salt Shed, Chicago, IL');
    expect(html).toContain('2 upcoming shows');
  });

  it('says so when there are more dates than it prints', () => {
    const one = { id: 'e1', startsAt: '2026-08-02T19:00:00Z', zone: null, venueId: null, venueName: null, city: null, region: null, country: null };
    expect(artistBody(ar({ shows: [one], truncated: true }))).toContain('1+ upcoming show');
    expect(artistBody(ar({ shows: [one], truncated: false }))).toContain('1 upcoming show,');
  });

  it('has something to say with nothing booked', () => {
    // The page is noindex in this state, but it still gets crawled for its links.
    const html = artistBody(ar({ shows: [] }));
    expect(html).toContain('No upcoming dates announced');
    expect(html).not.toContain('undefined');
  });
});

describe('the venue page a crawler sees', () => {
  it('lists what is on, and points back at the town', () => {
    const html = venueBody(
      ve({
        upcoming: 2,
        shows: [
          { id: 'e1', startsAt: '2026-08-02T19:00:00Z', zone: 'Europe/London', artistId: 'a1', artistName: 'Wolf Alice' },
        ],
        truncated: true,
      }),
    );
    expect(html).toContain('<h1>Brixton Academy</h1>');
    expect(html).toContain('2 upcoming concerts');
    expect(html).toContain('href="/event/e1"');
    expect(html).toContain('Wolf Alice');
    expect(html).toContain('href="/concerts/london-united-kingdom"');
    expect(html).toContain('More dates in the app.');
  });

  it('reads as one concert, singular', () => {
    expect(venueBody(ve({ upcoming: 1 }))).toContain('1 upcoming concert at');
  });

  it('does not invent a town link it cannot make', () => {
    const html = venueBody(ve({ city: null, region: null, country: null }));
    expect(html).not.toContain('/concerts/');
    expect(html).toContain('<h1>Brixton Academy</h1>');
  });
});
