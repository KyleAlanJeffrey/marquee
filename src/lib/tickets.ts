import type { EventDetail } from '@/lib/types';

export type TicketSource = {
  id: string;
  label: string;
  /** Official primary ticket, or a resale marketplace. */
  kind: 'official' | 'resale';
  url: string;
};

/**
 * A StubHub search deep link for a show. StubHub has no open listings API, so
 * we point at their search (artist + city) — it surfaces the event's resale
 * listings without us inventing prices we can't verify.
 */
export function stubhubSearchUrl(artist: string, city?: string | null): string {
  const q = [artist, city].filter(Boolean).join(' ');
  return `https://www.stubhub.com/explore?q=${encodeURIComponent(q)}`;
}

/** The ways to buy for an event: the official link (when known) + StubHub resale. */
export function ticketSources(e: EventDetail): TicketSource[] {
  const sources: TicketSource[] = [];
  if (e.ticket_url) {
    const label =
      e.source === 'ticketmaster'
        ? 'Ticketmaster'
        : e.source === 'bandsintown'
          ? 'Bandsintown'
          : 'Official box office';
    sources.push({ id: 'official', label, kind: 'official', url: e.ticket_url });
  }
  sources.push({
    id: 'stubhub',
    label: 'StubHub',
    kind: 'resale',
    url: stubhubSearchUrl(e.artist.name, e.venue?.city),
  });
  return sources;
}
