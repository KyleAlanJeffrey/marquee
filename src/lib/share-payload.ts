/**
 * The pure half of sharing: what gets said and where the link points.
 * RN-free on purpose so it can be unit-tested — the platform half
 * (sheet/clipboard) lives in share.ts.
 *
 * The URL is always the production one, whatever host the sender is on — a
 * link shared out of a dev build or a preview deploy must still open for the
 * recipient, and the server-rendered pages behind these URLs already carry
 * real titles and a mirrored artist image, so the unfurl looks designed
 * everywhere a link lands.
 */
export const SITE_ORIGIN = 'https://marquee.rocks';

export type SharePayload = { url: string; title: string; message: string };

/** The share text for one show: what, where, when — then the link. */
export function eventShare(e: {
  id: string;
  name: string;
  venueName?: string | null;
  venueCity?: string | null;
  /** Preformatted date line, venue-local (the caller has the timezone). */
  when: string;
}): SharePayload {
  const where = [e.venueName, e.venueCity].filter(Boolean).join(', ');
  return {
    url: `${SITE_ORIGIN}/event/${encodeURIComponent(e.id)}`,
    title: e.name,
    message: [e.name, where, e.when].filter(Boolean).join(' · '),
  };
}
