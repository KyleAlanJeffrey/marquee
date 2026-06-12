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
