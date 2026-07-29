/**
 * Turning a venue-local timestamp into UTC.
 *
 * Bandsintown publishes local time with no offset ("2026-08-06T20:00:00"), so
 * something has to supply the zone. Longitude alone can't: it has no idea about
 * daylight saving, which is an hour wrong for most of the year across most of the
 * data we hold — a 20:00 August show in San Francisco is 03:00Z, not 04:00Z.
 *
 * What we do have on every venue is `region` + `country`, and Workers ship full
 * ICU, so a state/province → IANA zone table plus `Intl` gives the real offset
 * for the event's own date, DST included. Longitude stays as the fallback for
 * everywhere the table doesn't cover.
 */

/**
 * Dominant zone per US state and Canadian province. A handful of states span two
 * zones (Texas, Nebraska, Florida, Indiana, Oregon, Idaho, the Dakotas); this
 * takes the one most of the state — and nearly all of its venues — sits in, which
 * beats being an hour out everywhere by way of being exact nowhere.
 */
const REGION_ZONES: Record<string, string> = {
  // Eastern
  CT: 'America/New_York', DC: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York',
  GA: 'America/New_York', IN: 'America/New_York', KY: 'America/New_York', MA: 'America/New_York',
  MD: 'America/New_York', ME: 'America/New_York', MI: 'America/New_York', NC: 'America/New_York',
  NH: 'America/New_York', NJ: 'America/New_York', NY: 'America/New_York', OH: 'America/New_York',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', VA: 'America/New_York',
  VT: 'America/New_York', WV: 'America/New_York',
  // Central
  AL: 'America/Chicago', AR: 'America/Chicago', IA: 'America/Chicago', IL: 'America/Chicago',
  KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago', MO: 'America/Chicago',
  MS: 'America/Chicago', ND: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago',
  SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago', WI: 'America/Chicago',
  // Mountain (Arizona keeps its own zone: no daylight saving)
  AZ: 'America/Phoenix', CO: 'America/Denver', MT: 'America/Denver', NM: 'America/Denver',
  UT: 'America/Denver', WY: 'America/Denver', ID: 'America/Boise',
  // Pacific and beyond
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles',
  WA: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
  PR: 'America/Puerto_Rico',
  // Canada
  BC: 'America/Vancouver', AB: 'America/Edmonton', SK: 'America/Regina', MB: 'America/Winnipeg',
  ON: 'America/Toronto', QC: 'America/Toronto', NB: 'America/Halifax', NS: 'America/Halifax',
  PE: 'America/Halifax', NL: 'America/St_Johns', YT: 'America/Whitehorse',
  NT: 'America/Yellowknife', NU: 'America/Iqaluit',
};

/** Countries where a two-letter region above is a state/province code. */
const REGION_COUNTRIES = new Set(['US', 'USA', 'UNITED STATES', 'CA', 'CAN', 'CANADA']);

/** The IANA zone for a venue, or null when we have to fall back to longitude. */
export function zoneFor(region: string | null | undefined, country: string | null | undefined): string | null {
  const c = country?.trim().toUpperCase();
  // Bandsintown sends "Canada" as the country and "" as the region; Ticketmaster
  // sends "CA"/"US" with a state code. Only trust the table where the region
  // really is a state or province code.
  if (c && !REGION_COUNTRIES.has(c)) return null;
  const r = region?.trim().toUpperCase();
  if (!r) return null;
  return REGION_ZONES[r] ?? null;
}

/**
 * A zone's offset from UTC, in minutes, at a given instant — so daylight saving
 * is whatever it actually was on the night of the show.
 */
export function zoneOffsetMinutes(zone: string, utcMs: number): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!name) return null;
    // "GMT-07:00", "GMT+05:30", or plain "GMT" at zero.
    const m = /GMT([+-])(\d{1,2}):?(\d{2})?/.exec(name);
    if (!m) return /GMT$/.test(name) ? 0 : null;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    // An unknown zone id, or an ICU build without offset names.
    return null;
  }
}

/**
 * UTC milliseconds for a wall-clock time in a zone. The offset depends on the
 * instant we're solving for, so it's applied twice: the first pass lands within
 * an hour, the second gets the DST transition right for every time except the
 * hour that doesn't exist in spring, where it settles one hour off — the best
 * anyone can do with a timestamp that never happened.
 */
export function utcMsFromLocal(localAsUtcMs: number, zone: string): number | null {
  const first = zoneOffsetMinutes(zone, localAsUtcMs);
  if (first === null) return null;
  const candidate = localAsUtcMs - first * 60_000;
  const second = zoneOffsetMinutes(zone, candidate);
  return second === null ? candidate : localAsUtcMs - second * 60_000;
}
