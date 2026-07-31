/**
 * The chrome shared by every page the Worker renders itself.
 *
 * The landing page and the city hubs are real HTML built on the edge rather than the
 * Expo shell (see landing.ts for why). Those pages want one look, one stylesheet
 * and one `<head>`, so the parts that aren't the content live here: the escaping,
 * the formatting, the CSS, and a `shell()` that assembles a complete document.
 *
 * The CSS is inlined into every response on purpose. It is ~6 KB gzipped, it has
 * to be present before first paint on a page whose whole job is to render without
 * JavaScript, and a separate request for it would cost more than it saves.
 */

// The app's own palette — see the note inside `css` below.
import { stage } from '../../src/constants/palette';
import { looksLikeEventTitle } from './dedupe';

const NAME = 'Marquee';

/**
 * The social card, with a version on it.
 *
 * Facebook, X, Slack, iMessage and Google all cache the card against its URL and
 * hold it for a long time — so redrawing the PNG in place does nothing for the
 * links people have already shared. The `?v` is what makes them fetch again, and
 * it has to be bumped whenever public/og-image.png is rebuilt.
 */
export const OG_IMAGE = '/og-image.png?v=3';

// --- text -------------------------------------------------------------------

export const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON-LD goes in raw, so close off the one sequence that could break out. */
export const ldJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

export const num = (n: number) => n.toLocaleString('en-US');

/**
 * What a search result will actually show of a description.
 *
 * Google and Bing cut the snippet around 160 characters, and Bing's site audit
 * flags anything past it — a description that overflows is copy nobody reads.
 * The templates are written to fit, but three of them interpolate names that
 * arrive from ticket feeds, where production holds a 195-character event name
 * and a 90-character venue name. So the budget is enforced in one place instead
 * of trusted at every call site.
 */
export const DESC_MAX = 155;

export function clampDesc(s: string): string {
  const text = s.replace(/\s+/g, ' ').trim();
  if (text.length <= DESC_MAX) return text;
  // Cut back to a word boundary so the ellipsis doesn't land mid-name. A name with
  // no space in its first 90 characters gets a hard cut rather than a stub.
  let cut = text.slice(0, DESC_MAX - 1);
  // …and never through the middle of a surrogate pair. Production holds an event
  // named entirely in mathematical bold ("𝟐𝟎𝟐𝟔 𝐓𝐖𝐒 𝐓𝐎𝐔𝐑…"), where every character is
  // two UTF-16 units; half of one is a lone surrogate in an HTML attribute.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(' ');
  const kept = space > 90 ? cut.slice(0, space) : cut;
  return kept.replace(/[\s,;:.—-]+$/, '') + '…';
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The date as the venue's town would say it. A show at 8pm local is stored as
 * 03:00Z the next morning, so formatting in UTC moves it a day — the one mistake
 * a listings page cannot make.
 */
export function when(
  iso: string,
  zone: string | null,
  // Set time not announced: the timestamp is a noon placeholder. The date is
  // real; the clock would be an invention, so it comes back empty — every
  // template already renders around an empty `time`.
  timeUnknown = false,
): { day: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '', time: '' };
  const f = (opts: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: zone ?? 'UTC', ...opts }).format(d);
    } catch {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(d);
    }
  };
  return {
    day: f({ weekday: 'short', month: 'short', day: 'numeric' }),
    time: timeUnknown ? '' : f({ hour: 'numeric', minute: '2-digit' }),
  };
}

export const placeOf = (city: string | null, region: string | null) =>
  [city, region].filter((s) => s && s.trim()).join(', ');

/**
 * The venue name, or nothing if it clearly isn't one — with tonight's act known.
 *
 * `looksLikeEventTitle` catches the shapes that are wrong on their own (a tour
 * title, a colon, a sentence). Knowing who is playing catches one more: the
 * performer's own name inside it, as in "YE (Kanye West) - LIVE IN SPAIN". No room
 * is named after tonight's act, so that string is the billing, not the address.
 *
 * Display only. Dropping a real name costs a line of detail; printing a fake one
 * makes the listing a lie. The town beside it is true either way.
 */
export function realVenueName(venueName: string | null, artistName: string): string | null {
  const name = venueName?.trim();
  if (!name || looksLikeEventTitle(name)) return null;
  const act = artistName.trim().toLowerCase();
  if (act.length > 2 && name.toLowerCase().includes(act)) return null;
  return name;
}

// --- pieces -----------------------------------------------------------------

export function bulbs(count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) out += `<i style="--i:${i}"></i>`;
  return `<div class="bulbs" aria-hidden="true">${out}</div>`;
}

const LOGO = `<svg width="26" height="26" viewBox="0 0 26 26" role="img" aria-hidden="true">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2fff6a"/><stop offset="1" stop-color="#00dbe9"/>
  </linearGradient></defs>
  <rect x="1" y="1" width="24" height="24" rx="7" fill="none" stroke="url(#g)" stroke-width="2"/>
  <g fill="url(#g)"><rect x="7" y="10" width="2.6" height="6" rx="1.3"/><rect x="11.7" y="6.5" width="2.6" height="13" rx="1.3"/><rect x="16.4" y="9" width="2.6" height="8" rx="1.3"/></g>
</svg>`;

export const masthead = `<div class="top">
    <a class="brand" href="/" aria-label="Marquee home">${LOGO}Marquee</a>
    <nav aria-label="Marquee">
      <a class="hide-sm" href="/browse">Browse</a>
      <a class="hide-sm" href="/map">Map</a>
      <a class="hide-sm" href="/search">Artists</a>
      <a class="cta" href="/explore">Open the app</a>
    </nav>
  </div>`;

/** Footer links. Pages pass their own extra column of links (nearby cities, say). */
export function pageFooter(extra = ''): string {
  return `<footer class="wrap">
  <nav aria-label="Marquee pages">
    <a href="/">Concerts near you</a>
    <a href="/explore">Open the app</a>
    <a href="/browse">Browse every show</a>
    <a href="/map">Concert map</a>
    <a href="/search">Find an artist</a>
    <a href="/following">Artists you follow</a>
    <a href="/saved">Saved shows</a>
    <a href="/sitemap.xml">Sitemap</a>
    <a href="/privacy">Privacy &amp; contact</a>
  </nav>
  ${extra}
  <p>Marquee is a free live-music radar built by Kyle Jeffrey. Listings come from Ticketmaster, SeatGeek and Bandsintown; artist detail from Spotify, Deezer and Wikipedia. Tickets are sold by those sites, not by us.</p>
</footer>`;
}

export const css = `
:root{
  /* One palette, one source: these interpolate from src/constants/palette.ts, the
     same module the app's theme builds from. They were literals until 2026-07-31,
     by which point --line-str had already drifted (.18 here, .20 in the app) —
     which is the whole argument. */
  --bg:${stage.background}; --bg-low:${stage.backgroundLowest}; --card:${stage.backgroundElevated}; --card-high:${stage.backgroundHigh};
  --line:${stage.border}; --line-str:${stage.borderTop};
  --ink:${stage.text}; --ink-2:${stage.textSecondary}; --ink-3:${stage.textTertiary};
  /* The neon green is the only dominant accent; cyan supports so it never saturates.
     --on-accent is the near-black that has to sit on top of lime — lime is far
     too bright to carry white text. */
  --accent:${stage.primary}; --accent-vivid:${stage.primaryVivid}; --on-accent:${stage.onPrimary};
  --cyan:${stage.cyan}; --warm:${stage.error};
  /* One typeface. The hierarchy is carried by weight and tracking, not by a
     second family — so these are role names over a single stack. */
  --font:'Anybody',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  --display:var(--font); --body:var(--font); --label:var(--font);
  --pad:clamp(20px,5vw,44px);
}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
  font-size:17px;line-height:1.65;letter-spacing:-.005em;
  -webkit-font-smoothing:antialiased;overflow-x:hidden;
}
/* Stage haze: two lights, one warm and one cold, thrown at the top of the page. */
body::before{
  content:'';position:absolute;inset:0 0 auto;height:min(900px,90vh);z-index:-2;pointer-events:none;
  background:
    radial-gradient(58% 42% at 18% 0%,rgba(47,255,106,.13),transparent 70%),
    radial-gradient(46% 38% at 88% 6%,rgba(125,244,255,.10),transparent 72%),
    linear-gradient(180deg,var(--bg-low),var(--bg) 70%);
}
/* Grain, so the flat dark reads as paper rather than as a void. */
body::after{
  content:'';position:fixed;inset:0;z-index:9;pointer-events:none;opacity:.05;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
a{color:inherit;text-decoration:none}
h1,h2,h3{font-family:var(--display);line-height:1.02;letter-spacing:-.035em;margin:0}
/* Caps italic ExtraBold is the signature, and it stays on the hero alone — it
   shouts on anything smaller. Headings below it are Bold upright. */
h1{font-weight:800;font-style:italic;text-transform:uppercase;letter-spacing:-.045em}
h2,h3{font-weight:700}
p{margin:0}
ol,ul{margin:0;padding:0;list-style:none}
.wrap{width:100%;max-width:1140px;margin-inline:auto;padding-inline:var(--pad)}
.skip{position:absolute;left:-9999px}
.skip:focus{left:var(--pad);top:12px;z-index:20;background:var(--accent);color:var(--on-accent);padding:10px 16px;border-radius:4px;font-family:var(--label);font-weight:700}
:focus-visible{outline:2px solid var(--cyan);outline-offset:3px;border-radius:4px}

.eyebrow{font-family:var(--label);font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}

/* --- masthead --- */
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 0 18px}
.brand{display:flex;align-items:center;gap:11px;font-family:var(--display);font-size:23px;letter-spacing:-.04em}
.brand svg{display:block;flex:none}
.top nav{display:flex;gap:6px;font-family:var(--label);font-size:13.5px;letter-spacing:.02em}
.top nav a{padding:9px 13px;border-radius:99px;color:var(--ink-2);transition:background .18s,color .18s}
.top nav a:hover{background:var(--card);color:var(--ink)}
.top nav a.cta{background:var(--accent);color:var(--on-accent);font-weight:700;border-radius:4px}
.top nav a.cta:hover{background:#fff}
@media(max-width:700px){.top nav a.hide-sm{display:none}}

/* --- marquee bulb rail --- */
.bulbs{display:flex;gap:10px;justify-content:space-between;padding:0 2px 30px;overflow:hidden}
.bulbs i{
  width:5px;height:5px;flex:none;border-radius:50%;background:var(--accent);
  box-shadow:0 0 10px 2px rgba(47,255,106,.5);opacity:.85;
  animation:flicker 3.4s calc(var(--i) * -.11s) infinite ease-in-out;
}
@keyframes flicker{0%,100%{opacity:.9;transform:scale(1)}42%{opacity:.22;transform:scale(.82)}}

/* --- hero --- */
.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(280px,.85fr);gap:clamp(28px,5vw,64px);align-items:end;padding-bottom:clamp(48px,7vw,84px)}
@media(max-width:940px){.hero{grid-template-columns:1fr;align-items:start}}
/* Caps are far wider than the mixed case this used to be set in, so the ceiling
   comes down to the 72px the design calls for rather than the old 88px. */
h1{font-size:clamp(36px,6.6vw,72px)}
/* City names are longer than "near you", so the hub hero starts a size smaller. */
.hero.tight h1{font-size:clamp(29px,5vw,54px)}
h1 .lit{
  background:linear-gradient(102deg,var(--accent-vivid),var(--accent) 42%,var(--cyan));
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
.lede{margin-top:22px;max-width:34ch;font-size:clamp(17px,2.1vw,20px);color:var(--ink-2)}
.hero.tight .lede{max-width:46ch}
.crumbs{font-family:var(--label);font-size:12.5px;letter-spacing:.06em;color:var(--ink-3);margin-bottom:14px}
.crumbs a:hover{color:var(--accent)}
.crumbs span{padding:0 7px;opacity:.5}
.buttons{display:flex;flex-wrap:wrap;gap:12px;margin-top:30px}
/* The positioning line, sitting under the CTAs where it answers the question the
   buttons raise: what do I have to hand over to open this? Nothing. */
.tagline{margin-top:18px;max-width:44ch;font-family:var(--label);font-size:13px;font-weight:500;letter-spacing:.04em;color:var(--ink-3)}
.btn{
  /* 4px, not a pill: pills belong to chips. */
  display:inline-flex;align-items:center;gap:9px;padding:15px 26px;border-radius:4px;
  font-family:var(--label);font-size:15px;font-weight:800;letter-spacing:.02em;
  /* Solid lime with near-black text, per the spec — no two-hue gradient. */
  background:var(--accent);color:var(--on-accent);
  box-shadow:0 12px 34px -16px rgba(47,255,106,.75);transition:transform .18s,box-shadow .18s;
}
.btn:hover{transform:translateY(-2px);box-shadow:0 18px 40px -16px rgba(47,255,106,.9)}
.btn.ghost{background:none;border:1px solid var(--line-str);color:var(--ink);box-shadow:none}
.btn.ghost:hover{border-color:var(--accent);color:var(--accent)}

/* The stat panel is a ticket stub: torn left edge, punched holes. */
.stub{position:relative;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:26px 26px 22px 32px;overflow:hidden}
.stub::before{content:'';position:absolute;left:14px;top:16px;bottom:16px;width:1px;background:repeating-linear-gradient(180deg,var(--line-str) 0 5px,transparent 5px 11px)}
.stub::after{content:'';position:absolute;left:8px;top:-9px;width:14px;height:14px;border-radius:50%;background:var(--bg);box-shadow:0 0 0 1px var(--line)}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:20px 18px}
.stat b{display:block;font-family:var(--display);font-size:clamp(26px,3.4vw,34px);letter-spacing:-.04em;line-height:1}
/* A date is four times as wide as a count and wraps at the number's size. */
.stat.txt b{font-size:clamp(17px,2.1vw,21px);line-height:1.2}
.stat span{display:block;margin-top:5px;font-family:var(--label);font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.stub .note{margin-top:22px;padding-top:16px;border-top:1px dashed var(--line-str);font-size:13.5px;color:var(--ink-3)}

/* --- sections --- */
section{padding:clamp(46px,6vw,74px) 0;border-top:1px solid var(--line)}
.head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:30px}
h2{font-size:clamp(27px,3.6vw,38px)}
.head p{max-width:52ch;color:var(--ink-3);font-size:15.5px}
.more{font-family:var(--label);font-size:13.5px;color:var(--accent);border-bottom:1px solid transparent;transition:border-color .18s}
.more:hover{border-color:var(--accent)}

/* Show rows, printed-listings style: date at the left, rule between each. */
.shows li{border-top:1px solid var(--line)}
.shows li:last-child{border-bottom:1px solid var(--line)}
.shows a{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:20px;align-items:center;padding:17px 6px;transition:background .16s,padding-left .16s}
/* A list row lights its left edge on hover — a 4px lime accent, per the spec. */
.shows a:hover{background:linear-gradient(90deg,rgba(47,255,106,.07),transparent 70%);padding-left:14px;box-shadow:inset 4px 0 0 var(--accent)}
.date{font-family:var(--label);font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--warm)}
.date small{display:block;font-size:11px;letter-spacing:.14em;color:var(--ink-3)}
.who{display:block;font-family:var(--display);font-weight:700;font-size:clamp(18px,2.2vw,22px);letter-spacing:-.03em}
.where{display:block;margin-top:3px;font-size:14.5px;color:var(--ink-3)}
.where b{color:var(--ink-2);font-weight:600}
.tag{font-family:var(--label);font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--cyan);white-space:nowrap}
/* A month rule, for the hub pages where the list runs long enough to need one. */
.shows li.month{display:flex;align-items:baseline;gap:14px;border-top:none;padding:26px 6px 8px;font-family:var(--label);font-size:12px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
.shows li.month::after{content:'';flex:1;height:1px;background:var(--line)}
.shows li.month:first-child{padding-top:0}
@media(max-width:620px){
  .shows a{grid-template-columns:1fr;gap:6px;padding:15px 4px}
  .shows a:hover{padding-left:8px}
  .tag{display:none}
}

/* City chips */
.chips{display:flex;flex-wrap:wrap;gap:10px}
.chips a{display:inline-flex;align-items:baseline;gap:8px;padding:11px 17px;border:1px solid var(--line);border-radius:99px;background:rgba(32,31,33,.6);font-size:15px;transition:border-color .18s,background .18s,transform .18s}
.chips a:hover{border-color:var(--accent);background:var(--card-high);transform:translateY(-1px)}
.chips em{font-family:var(--label);font-style:normal;font-size:12px;letter-spacing:.08em;color:var(--ink-3)}

/* Two lists side by side */
.cols{display:grid;grid-template-columns:1fr 1fr;gap:clamp(28px,4vw,56px)}
@media(max-width:820px){.cols{grid-template-columns:1fr}}
.rank li{border-bottom:1px solid var(--line)}
.rank a{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:13px 4px;transition:padding-left .16s,color .16s}
.rank a:hover{padding-left:10px;color:var(--accent)}
.rank .nm{font-weight:600}
.rank .sub{display:block;font-size:13.5px;color:var(--ink-3);font-weight:400}
.rank .ct{font-family:var(--label);font-size:12.5px;letter-spacing:.06em;color:var(--ink-3);white-space:nowrap}

/* How it works */
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(18px,2.4vw,26px)}
@media(max-width:860px){.steps{grid-template-columns:1fr}}
.step{position:relative;padding:28px 24px;border:1px solid var(--line);border-radius:12px;background:linear-gradient(180deg,rgba(42,42,44,.5),rgba(32,31,33,.25));overflow:hidden}
.step .n{position:absolute;top:-14px;right:8px;font-family:var(--display);font-size:86px;color:rgba(255,255,255,.045);letter-spacing:-.06em}
.step h3{font-size:20px;margin-bottom:10px}
.step p{font-size:15.5px;color:var(--ink-2)}

/* FAQ */
.faq{border-top:1px solid var(--line)}
.faq details{border-bottom:1px solid var(--line)}
.faq summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:19px 4px;cursor:pointer;font-family:var(--display);font-weight:700;font-size:18px;letter-spacing:-.02em;list-style:none}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:'+';font-family:var(--label);font-size:22px;color:var(--accent);transition:transform .2s}
.faq details[open] summary::after{transform:rotate(45deg)}
.faq p{padding:0 4px 22px;max-width:72ch;color:var(--ink-2);font-size:16px}

/* Prose, for the paragraph of real text a hub page carries. */
.prose{max-width:70ch;color:var(--ink-2);font-size:16.5px}
.prose p+p{margin-top:16px}

footer{border-top:1px solid var(--line);padding:40px 0 56px;color:var(--ink-3);font-size:14.5px}
footer nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin-bottom:18px;font-family:var(--label);font-size:13.5px}
footer nav a:hover{color:var(--accent)}
footer p{max-width:76ch}
footer .near{margin-bottom:18px;font-size:14px}
footer .near a{color:var(--ink-2)}
footer .near a:hover{color:var(--accent)}

/* One orchestrated entrance, then nothing moves again. */
.rise{animation:rise .75s both cubic-bezier(.16,.84,.34,1)}
@keyframes rise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){
  *,*::before,*::after{animation:none!important;transition:none!important}
}
`;

// --- document ---------------------------------------------------------------

export type Shell = {
  origin: string;
  canonical: string;
  title: string;
  description: string;
  jsonLd?: unknown;
  /** Everything between <body> and the footer. */
  body: string;
  /** Extra footer content, above the credit paragraph. */
  footerExtra?: string;
  /** Set on a page we'd rather Google didn't keep (an empty town, say). */
  noindex?: boolean;
};

/** A complete HTML document — the same head and chrome on every rendered page. */
export function shell(s: Shell): string {
  const image = s.origin + OG_IMAGE;
  const desc = clampDesc(s.description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(s.canonical)}">
<meta name="robots" content="${s.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}">
<meta name="author" content="Kyle Jeffrey">
<meta name="theme-color" content="#131315">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="${esc(s.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(s.canonical)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Marquee — find concerts near you">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(s.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anybody:ital,wght@0,400;0,500;0,600;0,700;0,800;1,800&amp;display=swap">
<style>${css}</style>
${s.jsonLd ? `<script type="application/ld+json">${ldJson(s.jsonLd)}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${s.body}
${pageFooter(s.footerExtra)}
</body>
</html>
`;
}

/** The three-card "how it works" block, shared by the landing and hub pages. */
export const HOW: { n: string; h: string; p: string }[] = [
  {
    n: '01',
    h: 'Point it at a place',
    p: 'Share your location or search any town. You get every upcoming show inside your radius as a feed, a grid or a map — filterable by genre, soonest first.',
  },
  {
    n: '02',
    h: 'Follow the acts and the rooms',
    p: 'Follow an artist and every date they announce collects in one tab. Follow a venue and its whole calendar does, however many sources filed it.',
  },
  {
    n: '03',
    h: 'Put shows aside',
    p: 'Save anything you are thinking about. Marquee re-checks the saved list against the live listings, so a moved door time or a pulled show tells you rather than surprising you.',
  },
];

export const howSection = `<section class="wrap">
  <div class="head">
    <div><p class="eyebrow">How it works</p><h2>Three things, done properly</h2></div>
    <p>No account, no feed algorithm, no email. Your follows live on your device.</p>
  </div>
  <div class="steps">
    ${HOW.map(
      (s) =>
        `<div class="step"><span class="n" aria-hidden="true">${s.n}</span><h3>${esc(s.h)}</h3><p>${esc(s.p)}</p></div>`,
    ).join('')}
  </div>
</section>`;

export type Faq = { q: string; a: string };

export function faqSection(items: Faq[], heading = 'Frequently asked'): string {
  return `<section class="wrap">
  <div class="head"><div><p class="eyebrow">Questions</p><h2>${esc(heading)}</h2></div></div>
  <div class="faq">
    ${items.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('')}
  </div>
</section>`;
}

export const faqJsonLd = (items: Faq[]) => ({
  '@type': 'FAQPage',
  mainEntity: items.map((f) => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
});
