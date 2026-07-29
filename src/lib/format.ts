/**
 * A show happens at a place, and the place has a clock. Every formatter here
 * takes the venue's IANA zone (`venue_timezone` from the API) so a 23:00 gig in
 * London reads as 11:00 PM wherever it's being read — before this, browsing
 * another town showed every show shifted into the reader's own timezone.
 *
 * The zone is optional: outside North America and the single-zone countries the
 * API can't name one, and then these fall back to the device clock, which for
 * shows nearby is the right answer anyway.
 */
export function formatEventDate(iso: string, timeZone?: string | null): string {
  const date = new Date(iso);
  const sameYear = yearIn(date, timeZone) === yearIn(new Date(), timeZone);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    ...zone(timeZone),
  });
}

/** Compact parts for a calendar-style date chip. */
export function formatEventDateParts(
  iso: string,
  timeZone?: string | null,
): {
  weekday: string;
  day: string;
  month: string;
} {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short', ...zone(timeZone) }).toUpperCase(),
    day: date.toLocaleDateString(undefined, { day: 'numeric', ...zone(timeZone) }),
    month: date.toLocaleDateString(undefined, { month: 'short', ...zone(timeZone) }).toUpperCase(),
  };
}

/** Human relative day: "Tonight", "Tomorrow", "In 3 days", else the date. */
export function formatRelativeDay(iso: string, timeZone?: string | null): string {
  // Compared as calendar days in the venue's zone: "tonight" is about the night
  // at the venue, and a late show is easily a different date in each zone.
  const days = dayNumber(new Date(iso), timeZone) - dayNumber(new Date(), timeZone);
  if (days < 0) return formatEventDate(iso, timeZone);
  if (days === 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return formatEventDate(iso, timeZone);
}

export function formatTime(iso: string, timeZone?: string | null): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    ...zone(timeZone),
  });
}

/**
 * A short zone label ("BST", "PDT") for a show whose zone isn't the reader's, so
 * "11:00 PM" can't be read as 11pm here. Null when the zones agree, which is the
 * common case and doesn't need the noise.
 */
export function formatZoneLabel(iso: string, timeZone?: string | null): string | null {
  if (!timeZone || timeZone === deviceZone()) return null;
  try {
    const date = new Date(iso);
    const label = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value;
    // Where the abbreviation is just a numeric offset ("GMT+2"), that reads fine.
    return label ?? null;
  } catch {
    return null;
  }
}

const zone = (timeZone?: string | null) => (timeZone ? { timeZone } : {});

const deviceZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

/** Calendar day as a single number, in whichever zone we're reckoning in. */
function dayNumber(date: Date, timeZone?: string | null): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...zone(timeZone),
  }).format(date);
  // en-CA gives YYYY-MM-DD, which Date.UTC can consume unambiguously.
  const [y, m, d] = parts.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

const yearIn = (date: Date, timeZone?: string | null) =>
  date.toLocaleDateString('en-CA', { year: 'numeric', ...zone(timeZone) });

export function formatVenue(
  name: string | null,
  city: string | null,
  region: string | null,
): string {
  const place = [city, region].filter(Boolean).join(', ');
  return [name, place].filter(Boolean).join(' · ') || 'Venue TBA';
}

export function formatDistance(miles: number | null): string | null {
  if (miles == null) return null;
  return miles < 1 ? '<1 mi' : `${Math.round(miles)} mi`;
}

/** "$35+" for a known low price, else a neutral fallback. */
export function formatPrice(from: number | null): string {
  if (from == null) return 'Tickets';
  if (from === 0) return 'Free';
  return `$${Math.round(from)}+`;
}

/** Compact count: 1234 -> "1.2K", 1_500_000 -> "1.5M". */
export function formatCount(n: number | null): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}
