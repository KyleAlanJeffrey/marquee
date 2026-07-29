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

/**
 * Countries that sit in a single zone, so the country alone is enough. Deliberately
 * excludes the multi-zone ones (Mexico, Brazil, Indonesia, Australia, Russia,
 * Kazakhstan) where a country-level guess would be confidently wrong.
 */
const COUNTRY_ZONES: Record<string, string> = {
  GB: 'Europe/London', IE: 'Europe/Dublin', PT: 'Europe/Lisbon', IS: 'Atlantic/Reykjavik',
  ES: 'Europe/Madrid', FR: 'Europe/Paris', BE: 'Europe/Brussels', NL: 'Europe/Amsterdam',
  LU: 'Europe/Luxembourg', DE: 'Europe/Berlin', CH: 'Europe/Zurich', AT: 'Europe/Vienna',
  IT: 'Europe/Rome', DK: 'Europe/Copenhagen', NO: 'Europe/Oslo', SE: 'Europe/Stockholm',
  PL: 'Europe/Warsaw', CZ: 'Europe/Prague', SK: 'Europe/Bratislava', HU: 'Europe/Budapest',
  SI: 'Europe/Ljubljana', HR: 'Europe/Zagreb', RS: 'Europe/Belgrade', RO: 'Europe/Bucharest',
  BG: 'Europe/Sofia', GR: 'Europe/Athens', FI: 'Europe/Helsinki', EE: 'Europe/Tallinn',
  LV: 'Europe/Riga', LT: 'Europe/Vilnius', TR: 'Europe/Istanbul', IL: 'Asia/Jerusalem',
  AE: 'Asia/Dubai', IN: 'Asia/Kolkata', JP: 'Asia/Tokyo', KR: 'Asia/Seoul',
  SG: 'Asia/Singapore', HK: 'Asia/Hong_Kong', TW: 'Asia/Taipei', TH: 'Asia/Bangkok',
  VN: 'Asia/Ho_Chi_Minh', PH: 'Asia/Manila', MY: 'Asia/Kuala_Lumpur', NZ: 'Pacific/Auckland',
  ZA: 'Africa/Johannesburg', EG: 'Africa/Cairo', MA: 'Africa/Casablanca', NG: 'Africa/Lagos',
  AR: 'America/Argentina/Buenos_Aires', CL: 'America/Santiago', CO: 'America/Bogota',
  PE: 'America/Lima', UY: 'America/Montevideo', CR: 'America/Costa_Rica', PA: 'America/Panama',
};

/** Bandsintown sends country names where Ticketmaster sends codes. */
const COUNTRY_ALIASES: Record<string, string> = {
  'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB',
  'NORTHERN IRELAND': 'GB', UK: 'GB', IRELAND: 'IE', PORTUGAL: 'PT', ICELAND: 'IS',
  SPAIN: 'ES', FRANCE: 'FR', BELGIUM: 'BE', NETHERLANDS: 'NL', 'THE NETHERLANDS': 'NL',
  LUXEMBOURG: 'LU', GERMANY: 'DE', SWITZERLAND: 'CH', AUSTRIA: 'AT', ITALY: 'IT',
  DENMARK: 'DK', NORWAY: 'NO', SWEDEN: 'SE', POLAND: 'PL', 'CZECH REPUBLIC': 'CZ',
  CZECHIA: 'CZ', SLOVAKIA: 'SK', HUNGARY: 'HU', SLOVENIA: 'SI', CROATIA: 'HR',
  SERBIA: 'RS', ROMANIA: 'RO', BULGARIA: 'BG', GREECE: 'GR', FINLAND: 'FI',
  ESTONIA: 'EE', LATVIA: 'LV', LITHUANIA: 'LT', TURKEY: 'TR', ISRAEL: 'IL',
  'UNITED ARAB EMIRATES': 'AE', INDIA: 'IN', JAPAN: 'JP', 'SOUTH KOREA': 'KR',
  SINGAPORE: 'SG', 'HONG KONG': 'HK', TAIWAN: 'TW', THAILAND: 'TH', VIETNAM: 'VN',
  PHILIPPINES: 'PH', MALAYSIA: 'MY', 'NEW ZEALAND': 'NZ', 'SOUTH AFRICA': 'ZA',
  EGYPT: 'EG', MOROCCO: 'MA', NIGERIA: 'NG', ARGENTINA: 'AR', CHILE: 'CL',
  COLOMBIA: 'CO', PERU: 'PE', URUGUAY: 'UY', 'COSTA RICA': 'CR', PANAMA: 'PA',
};

/**
 * The IANA zone for a venue, or null when we have to fall back to longitude.
 * North American venues resolve through their state or province; elsewhere the
 * country answers, as long as the country has only one zone.
 */
export function zoneFor(region: string | null | undefined, country: string | null | undefined): string | null {
  const raw = country?.trim().toUpperCase() ?? '';
  const c = COUNTRY_ALIASES[raw] ?? raw;
  const r = region?.trim().toUpperCase();
  // Bandsintown sends "Canada" as the country and "" as the region; Ticketmaster
  // sends "CA"/"US" with a state code. Only read the region as a state or province
  // where the country says it is one — "CA" is also California.
  //
  // A missing country still reads the region: the only rows without one are the
  // local dev seed's US venues, and both real sources always send a country, so
  // this can't quietly relabel a foreign venue as American.
  if (!raw || REGION_COUNTRIES.has(raw)) return r ? REGION_ZONES[r] ?? null : null;
  return COUNTRY_ZONES[c] ?? null;
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
