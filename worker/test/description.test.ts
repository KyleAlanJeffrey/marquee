import { describe, expect, it } from 'vitest';

import { cityDescription, type Town } from '../src/cities';
import { DESCRIPTION as LANDING_DESCRIPTION } from '../src/landing';
import { DESC_MAX, clampDesc } from '../src/page';
import { STATIC_PAGES } from '../src/seo';

/**
 * Bing's site audit flagged "Meta Description too long or too short", and it was
 * right about more than the one page it happened to scan: every city hub was over,
 * and the event, artist and venue templates interpolate names that arrive from
 * ticket feeds. The longest real ones in production, measured:
 *
 *   event name   195  "Tommy Stinson (The Replacements) & Friends at Tip Top Deluxe…"
 *   venue name    90  "Phish Fenway Afterparty N1 - Weird Phishes at Bill's Bar (…)"
 *   town label    42  "Kota Administrasi Jakarta Pusat, Indonesia"
 *
 * So these hold the budget at the worst case rather than the typical one. The
 * lower bound is the other half of the same Bing check — a 40-character snippet
 * wastes the one piece of copy a search result gives us.
 */

const DESC_MIN = 70;

const LONGEST_EVENT_NAME =
  'Tommy Stinson (The Replacements) & Friends at Tip Top Deluxe Bar & Grill Grand Rapids';
const LONGEST_VENUE_NAME =
  "Phish Fenway Afterparty N1 - Weird Phishes at Bill's Bar (Door Tickets WILL BE Available!)";
const LONGEST_TOWN_LABEL = 'Kota Administrasi Jakarta Pusat, Indonesia';

const town = (over: Partial<Town> = {}): Town => ({
  city: 'Austin',
  region: 'TX',
  country: 'United States',
  label: 'Austin, TX',
  slug: 'austin-tx',
  upcoming: 214,
  venues: 61,
  lat: 30.27,
  lng: -97.74,
  cities: ['austin'],
  regions: ['tx'],
  aliases: ['austin-tx'],
  ...over,
});

describe('clampDesc', () => {
  it('leaves a description that already fits completely alone', () => {
    const fits = 'Every upcoming concert in Austin, TX: 214 shows at 61 venues.';
    expect(clampDesc(fits)).toBe(fits);
  });

  it('never returns more than a search result would show', () => {
    const long = `${LONGEST_EVENT_NAME} plays ${LONGEST_VENUE_NAME}, Boston, MA on Sat, Aug 1, 2026. Doors, tickets and the rest of the tour.`;
    expect(long.length).toBeGreaterThan(DESC_MAX);
    expect(clampDesc(long).length).toBeLessThanOrEqual(DESC_MAX);
  });

  it('cuts at a word, and says it cut', () => {
    const out = clampDesc(
      `${LONGEST_EVENT_NAME} plays Tip Top Deluxe Bar in Grand Rapids, MI on Sat, Aug 1, 2026. ` +
        'Doors, tickets and the rest of the tour.',
    );
    expect(out.endsWith('…')).toBe(true);
    // Not mid-word, and not left dangling on punctuation before the ellipsis.
    expect(out).not.toMatch(/[\s,;:.—-]…$/);
    expect(out.startsWith('Tommy Stinson (The Replacements)')).toBe(true);
  });

  it('hard-cuts a name with no space to fall back to', () => {
    const out = clampDesc('A'.repeat(300));
    expect(out.length).toBe(DESC_MAX);
    expect(out.endsWith('…')).toBe(true);
  });

  it('collapses the newlines a multi-line template literal leaves behind', () => {
    expect(clampDesc('Concerts in Austin,\n  TX  tonight.')).toBe('Concerts in Austin, TX tonight.');
  });
});

describe('the descriptions the site actually ships', () => {
  it('fits a city hub without needing the clamp, at the longest label there is', () => {
    // Four-digit counts it will never reach, on top of the longest label.
    const worst = cityDescription(town({ label: LONGEST_TOWN_LABEL, upcoming: 9999, venues: 999 }));
    expect(worst.length).toBeLessThanOrEqual(DESC_MAX);
    expect(clampDesc(worst)).toBe(worst);
  });

  it('fits the real hubs Bing flagged, and says enough to be worth showing', () => {
    for (const [label, upcoming, venues] of [
      ['Austin, TX', 214, 61],
      ['London, United Kingdom', 309, 48],
      ['New York, NY', 512, 97],
    ] as const) {
      const d = cityDescription(town({ label, upcoming, venues }));
      expect(d.length).toBeGreaterThanOrEqual(DESC_MIN);
      expect(d.length).toBeLessThanOrEqual(DESC_MAX);
    }
  });

  it('reads as one show at one venue when that is all there is', () => {
    expect(cityDescription(town({ upcoming: 1, venues: 1 }))).toContain('1 show at 1 venue,');
  });

  it('keeps the landing page inside the budget', () => {
    expect(LANDING_DESCRIPTION.length).toBeGreaterThanOrEqual(DESC_MIN);
    expect(LANDING_DESCRIPTION.length).toBeLessThanOrEqual(DESC_MAX);
  });

  it('keeps every prerendered app route inside the budget', () => {
    for (const [path, page] of Object.entries(STATIC_PAGES)) {
      expect(page.description.length, `${path} description`).toBeGreaterThanOrEqual(DESC_MIN);
      expect(page.description.length, `${path} description`).toBeLessThanOrEqual(DESC_MAX);
    }
  });
});
