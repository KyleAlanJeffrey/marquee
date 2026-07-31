import { citySlug } from './cities';
import { esc, placeOf, when } from './page';

/**
 * The `<body>` a crawler sees on `/event/:id`, `/artist/:id` and `/venue/:id`.
 *
 * These are the pages worth ranking — "artist tour dates", "tickets at venue" — and
 * until now every one of them shipped the same empty shell. `seo.ts` fixed their
 * `<head>`; this fixes what is under it, from rows those same queries already read.
 *
 * The markup goes *inside* `#root`, replacing the export's prerendered spinner, and
 * the Worker flips `__EXPO_ROUTER_HYDRATE__` off so the bundle mounts with
 * `createRoot().render()` instead of hydrating. React clears the container on mount,
 * so the app takes the page over exactly as before — the difference is only what is
 * there in the meantime: the show, rather than a loading wheel.
 *
 * Which also means this is not a place for cleverness. It's read once by a crawler
 * and seen for a moment by a human on a slow connection, so it's plain HTML, styled
 * enough not to look broken, and every link is a real `<a href>`.
 */

/**
 * `body{overflow:hidden}` and `#root{display:flex;height:100%}` come from Expo's
 * ScrollViewStyleReset, so a long list injected into `#root` would be clipped at the
 * fold with no way to scroll it. Hence `overflow:auto` on our own container.
 *
 * Everything is scoped under `#mq-sr` — the app owns the rest of the document.
 */
const STYLE = `<style>
/* The app registers Anybody under the @expo-google-fonts family names, so those
   come first; plain 'Anybody' covers the case where the webfont came from the
   server-rendered pages instead. */
#mq-sr{flex:1;overflow:auto;-webkit-overflow-scrolling:touch;background:#131315;color:#e5e1e4;
  font:400 16px/1.6 Anybody_400Regular,Anybody,system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 20px 64px}
#mq-sr .in{max-width:760px;margin:0 auto}
#mq-sr a{color:#2fff6a}
#mq-sr .crumbs{font-size:13px;letter-spacing:.04em;text-transform:uppercase;opacity:.6;margin:0 0 18px}
#mq-sr .crumbs a{color:inherit;text-decoration:none}
#mq-sr h1{font:italic 800 clamp(26px,5vw,40px)/1.15 Anybody_800ExtraBold_Italic,Anybody,system-ui,sans-serif;
  margin:0 0 10px;letter-spacing:-.03em;text-transform:uppercase}
#mq-sr .lede{font-size:17px;opacity:.78;margin:0 0 24px}
#mq-sr h2{font:700 19px/1.3 Anybody_700Bold,Anybody,system-ui,sans-serif;margin:34px 0 12px}
/* Lime is far too bright for white text, so the CTA label is the near-black. */
#mq-sr .cta{display:inline-block;background:#2fff6a;color:#00230f;font-weight:700;text-decoration:none;
  padding:12px 20px;border-radius:4px;margin:6px 0 4px}
#mq-sr ul{list-style:none;margin:0;padding:0}
#mq-sr li{border-top:1px solid rgba(229,225,228,.12);padding:12px 0}
#mq-sr li b{display:block;font-weight:600}
#mq-sr li span{font-size:14px;opacity:.7}
#mq-sr .facts{margin:0 0 20px}
#mq-sr .facts div{border-top:1px solid rgba(229,225,228,.12);padding:9px 0;display:flex;gap:14px}
#mq-sr .facts dt{opacity:.6;min-width:88px;font-size:14px}
#mq-sr .facts dd{margin:0}
#mq-sr .more{font-size:14px;opacity:.7}
</style>`;

const CRUMB_HOME = '<a href="/">Marquee</a>';

/** The container the app will replace, with the crumbs every one of these carries. */
function frame(crumbs: string, inner: string): string {
  return `${STYLE}<div id="mq-sr"><div class="in">
<p class="crumbs">${CRUMB_HOME} ${crumbs}</p>
${inner}
</div></div>`;
}

/** A city hub link, when the town has a slug to link to. */
function hubLink(city: string | null, region: string | null, country: string | null): string {
  if (!city?.trim()) return '';
  const slug = citySlug(city, region, country);
  if (!slug) return esc(placeOf(city, region));
  return `<a href="/concerts/${esc(slug)}">${esc(placeOf(city, region) || city)}</a>`;
}

const fact = (label: string, value: string) =>
  value ? `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>` : '';

/**
 * Ticket URLs come from third-party feeds, and this is the one place we put a
 * foreign string in an `href` a person will click. Escaping handles the markup;
 * only an http(s) allowlist handles `javascript:`.
 */
function safeHref(url: string | null): string | null {
  const raw = url?.trim();
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

const US = new Set(['us', 'usa', 'united states', 'united states of america']);

/**
 * The price, but only where we know what currency it is in.
 *
 * `events.price_from` has no currency beside it, and the feeds that fill it quote
 * their local one — so "$42" on a Toronto show is a number in the wrong money, and
 * an `offers.priceCurrency: USD` that disagrees with the ticket page is worse than
 * no offer at all. Seven upcoming shows are affected today; the honest answer for
 * them is silence until the column exists.
 */
export function usdFrom(priceFrom: number | null, country: string | null): number | null {
  if (priceFrom == null) return null;
  return US.has((country ?? '').trim().toLowerCase()) ? priceFrom : null;
}

// --- event ------------------------------------------------------------------

export type EventBody = {
  id: string;
  name: string;
  startsAt: string;
  zone: string | null;
  ticketUrl: string | null;
  priceFrom: number | null;
  artistId: string;
  artistName: string;
  venueId: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  /** Other upcoming dates by the same act — the tour this show belongs to. */
  alsoPlaying: {
    id: string;
    startsAt: string;
    zone: string | null;
    venueName: string | null;
    city: string | null;
    region: string | null;
  }[];
};

export function eventBody(d: EventBody): string {
  const t = when(d.startsAt, d.zone);
  const where = placeOf(d.city, d.region);
  // Festivals are filed with the bill as the venue name, so the event and the "venue"
  // are often the same string. Naming it twice in one sentence reads like a bug.
  const venueWorthSaying =
    d.venueName && d.venueName.trim().toLowerCase() !== d.name.trim().toLowerCase()
      ? d.venueName
      : null;
  const venue = d.venueName
    ? d.venueId
      ? `<a href="/venue/${esc(d.venueId)}">${esc(d.venueName)}</a>`
      : esc(d.venueName)
    : '';

  const tickets = safeHref(d.ticketUrl);
  const usd = usdFrom(d.priceFrom, d.country);
  const facts = [
    fact('Date', esc([t.day, t.time].filter(Boolean).join(' · '))),
    fact('Venue', venue),
    fact('City', hubLink(d.city, d.region, d.country)),
    fact('Artist', `<a href="/artist/${esc(d.artistId)}">${esc(d.artistName)}</a>`),
    fact('From', usd != null ? `$${esc(String(usd))}` : ''),
  ].join('');

  const tour = d.alsoPlaying.length
    ? `<h2>${esc(d.artistName)} on tour</h2>
<ul>${d.alsoPlaying
        .map((s) => {
          const w = when(s.startsAt, s.zone);
          const at = [s.venueName, placeOf(s.city, s.region)].filter(Boolean).join(', ');
          return `<li><a href="/event/${esc(s.id)}"><b>${esc(w.day)}</b></a>${
            at ? `<span>${esc(at)}</span>` : ''
          }</li>`;
        })
        .join('')}</ul>`
    : '';

  return frame(
    `· <a href="/artist/${esc(d.artistId)}">${esc(d.artistName)}</a>${
      where ? ` · ${hubLink(d.city, d.region, d.country)}` : ''
    }`,
    `<h1>${esc(d.name)}</h1>
<p class="lede">${esc(d.artistName)} plays ${
      venueWorthSaying
        ? `${esc(venueWorthSaying)}${where ? ` in ${esc(where)}` : ''}`
        : where
          ? `in ${esc(where)}`
          : 'live'
    }${t.day ? ` on ${esc(t.day)}` : ''}${t.time ? `, doors around ${esc(t.time)}` : ''}.</p>
<dl class="facts">${facts}</dl>
${tickets ? `<a class="cta" rel="nofollow noopener" href="${esc(tickets)}">Get tickets</a>` : ''}
${tour}`,
  );
}

// --- artist -----------------------------------------------------------------

export type ArtistBody = {
  id: string;
  name: string;
  genres: string[];
  shows: {
    id: string;
    startsAt: string;
    zone: string | null;
    venueId: string | null;
    venueName: string | null;
    city: string | null;
    region: string | null;
    country: string | null;
  }[];
  /** True when the act has more dates than this list prints. */
  truncated: boolean;
};

export function artistBody(d: ArtistBody): string {
  const dates = d.shows.length
    ? `<ul>${d.shows
        .map((s) => {
          const w = when(s.startsAt, s.zone);
          const at = [s.venueName, placeOf(s.city, s.region)].filter(Boolean).join(', ');
          return `<li><a href="/event/${esc(s.id)}"><b>${esc(w.day)}${
            w.time ? ` · ${esc(w.time)}` : ''
          }</b></a>${at ? `<span>${esc(at)}</span>` : ''}</li>`;
        })
        .join('')}</ul>${
        d.truncated ? '<p class="more">More dates in the app.</p>' : ''
      }`
    : `<p class="lede">No upcoming dates announced. Follow ${esc(
        d.name,
      )} in the app and Marquee will tell you when one lands near you.</p>`;

  return frame(
    '· Artists',
    `<h1>${esc(d.name)} tour dates</h1>
<p class="lede">${esc(d.name)}${
      d.genres.length ? ` — ${esc(d.genres.join(', '))}` : ''
    }. ${d.shows.length ? `${d.shows.length}${d.truncated ? '+' : ''} upcoming show${d.shows.length === 1 ? '' : 's'}, soonest first.` : ''}</p>
<h2>Upcoming shows</h2>
${dates}
<a class="cta" href="/explore">Open Marquee</a>`,
  );
}

// --- venue ------------------------------------------------------------------

export type VenueBody = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  upcoming: number;
  shows: { id: string; startsAt: string; zone: string | null; artistId: string; artistName: string }[];
  truncated: boolean;
};

export function venueBody(d: VenueBody): string {
  const where = placeOf(d.city, d.region);
  const list = d.shows.length
    ? `<ul>${d.shows
        .map((s) => {
          const w = when(s.startsAt, s.zone);
          return `<li><a href="/event/${esc(s.id)}"><b>${esc(s.artistName)}</b></a><span>${esc(
            [w.day, w.time].filter(Boolean).join(' · '),
          )}</span></li>`;
        })
        .join('')}</ul>${d.truncated ? '<p class="more">More dates in the app.</p>' : ''}`
    : '<p class="lede">Nothing on the calendar here yet.</p>';

  return frame(
    where ? `· ${hubLink(d.city, d.region, d.country)}` : '· Venues',
    `<h1>${esc(d.name)}</h1>
<p class="lede">${
      d.upcoming > 0
        ? `${d.upcoming} upcoming concert${d.upcoming === 1 ? '' : 's'}`
        : 'Upcoming concerts'
    } at ${esc(d.name)}${where ? ` in ${esc(where)}` : ''}.</p>
<h2>What's on</h2>
${list}
${where ? `<p class="more">More around ${hubLink(d.city, d.region, d.country)}.</p>` : ''}`,
  );
}
