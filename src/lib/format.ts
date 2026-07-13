export function formatEventDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** Compact parts for a calendar-style date chip. */
export function formatEventDateParts(iso: string): {
  weekday: string;
  day: string;
  month: string;
} {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase(),
    day: String(date.getDate()),
    month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
  };
}

/** Human relative day: "Tonight", "Tomorrow", "In 3 days", else the date. */
export function formatRelativeDay(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startOfDate.getTime() - startOfToday.getTime()) / 86_400_000);
  if (days <= 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return `In ${days} days`;
  return formatEventDate(iso);
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

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
