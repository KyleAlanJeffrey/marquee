import { and, gte, sql } from 'drizzle-orm';

import { citySlug } from './cities';
import type { DB } from './db';
import { getDb } from './db';
import type { Env } from './env';
import { events, indexnowLog, venues } from './schema';

/**
 * Tell the search engines about a show the moment we have it.
 *
 * The crawl runs hourly and writes shows that go on sale weeks before the date.
 * Waiting for Google to notice on its own means the page is indexed some time
 * between tomorrow and never, and by then the interesting window — "who's playing
 * next weekend" — has moved on. IndexNow is a single POST that Bing, Yandex,
 * Seznam and Naver all read, and it takes minutes rather than days.
 *
 * Google is not an IndexNow participant, so this is not a substitute for the
 * sitemap; it's the fast path for everyone else, and everyone else is where the
 * AI answer engines get a good deal of their index.
 *
 * Off unless `INDEXNOW_KEY` is set:
 *
 *   npx wrangler secret put INDEXNOW_KEY      # any 8–128 char hex string you invent
 *
 * The key doubles as proof of ownership: crawlers fetch `/<key>.txt` and expect
 * the key back, which is why the route below exists.
 */

const ENDPOINT = 'https://api.indexnow.org/indexnow';

/** The protocol's own ceiling per request. */
const MAX_URLS = 10_000;

/** A key has to look like a key — this is also what the .txt route matches on. */
export const KEY_SHAPE = /^[A-Za-z0-9-]{8,128}$/;

/**
 * How long a listing page counts as already announced.
 *
 * `/` and the city hubs do change whenever a show is added, which is most runs —
 * but every run re-sending the same couple of hundred listing URLs is 96
 * announcements a day per page, and IndexNow answers that with 429 "Too Many
 * Requests (potential Spam)". It isn't a volume limit: a one-off POST of 200
 * never-submitted event URLs from this host and key is accepted, while a cron
 * payload of 263 that re-announced 111 hubs was refused seconds either side of it.
 *
 * Event URLs are exempt. Each is a page that did not exist an hour ago, which is
 * the thing the protocol is for.
 */
const LISTING_TTL_HOURS = 24;

export type IndexNowResult = {
  submitted: number;
  events: number;
  cities: number;
  /** Listing pages held back because they were announced inside the TTL. */
  skipped: number;
  status: number;
};

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const hoursAgoIso = (hours: number) =>
  new Date(Date.now() - hours * 3_600_000).toISOString().slice(0, 19) + 'Z';

/** The paths in `candidates` that aren't in the recently-announced set. */
export function unannounced(candidates: string[], announced: Set<string>): string[] {
  return candidates.filter((p) => !announced.has(p));
}

/**
 * Whether a response status means "consider these announced".
 *
 * Success, obviously. And 429 — which is the case that matters, because recording
 * only successes deadlocks: the throttle exists to stop re-announcing listing pages,
 * so a host being refused *for* re-announcing them never builds up a log, never
 * skips anything, and gets refused again forever. Observed in production as
 * `skipped: 0, status: 429` on consecutive runs.
 *
 * Anything else (403 on a rejected key, 422 on a host mismatch) is a different fault
 * and should be retried rather than backed off from.
 */
export const recordsOn = (status: number): boolean =>
  (status >= 200 && status < 300) || status === 429;

async function announcedSince(db: DB, cutoff: string): Promise<Set<string>> {
  // The whole recent window in one read rather than asking about each path: D1 caps
  // a statement at 100 bound parameters, and a busy run has more hubs than that.
  const rows = await db
    .select({ url: indexnowLog.url })
    .from(indexnowLog)
    .where(gte(indexnowLog.submittedAt, cutoff));
  return new Set(rows.map((r) => r.url));
}

async function recordAnnounced(db: DB, paths: string[], at: string): Promise<void> {
  // Two bound parameters a row, against D1's ceiling of 100.
  for (let i = 0; i < paths.length; i += 40) {
    await db
      .insert(indexnowLog)
      .values(paths.slice(i, i + 40).map((url) => ({ url, submittedAt: at })))
      .onConflictDoUpdate({ target: indexnowLog.url, set: { submittedAt: at } });
  }
}

/**
 * Announce everything written since `since`.
 *
 * `created_at` is the insert time and is never rewritten (the ingest upsert is
 * `on conflict do nothing`), so "created since the crawl started" is exactly the
 * set of URLs that did not exist last hour. Shows that have already happened are
 * skipped: a past event is noindex anyway, and asking a crawler to fetch a page we
 * tell it not to keep is a way to be trusted less next time.
 */
export async function submitFresh(env: Env, since: string): Promise<IndexNowResult | null> {
  const key = env.INDEXNOW_KEY;
  const host = env.PRIMARY_HOST;
  // Without a canonical host there is no absolute URL to submit, and IndexNow
  // rejects a list whose host doesn't match the key's.
  //
  // Said out loud, because returning quietly is how this went unnoticed: the key had
  // been set as a plain environment variable in the dashboard, `wrangler deploy`
  // replaced the vars block with the one in wrangler.jsonc, and submissions stopped
  // with no 429, no error and no line in the log — indistinguishable from a run that
  // had nothing to announce.
  if (!key || !host) {
    console.log(`indexnow: off (${!key ? 'INDEXNOW_KEY' : 'PRIMARY_HOST'} not bound)`);
    return null;
  }
  if (!KEY_SHAPE.test(key)) {
    console.warn('indexnow: INDEXNOW_KEY is not 8–128 of [A-Za-z0-9-]; skipping');
    return null;
  }

  const db = getDb(env.DB);
  const rows = await db
    .select({
      id: events.id,
      city: venues.city,
      region: venues.region,
      country: venues.country,
    })
    .from(events)
    .leftJoin(venues, sql`${venues.id} = ${events.venueId}`)
    .where(and(gte(events.createdAt, since), gte(events.startsAt, nowIso())))
    .limit(MAX_URLS);

  if (rows.length === 0) {
    console.log('indexnow: nothing new to announce');
    return null;
  }

  const origin = `https://${host}`;
  const cities = new Set<string>();
  for (const r of rows) {
    if (!r.city?.trim()) continue;
    // Empty slug means the town has no hub page; don't submit `/concerts/`.
    const slug = citySlug(r.city, r.region, r.country);
    if (slug) cities.add(`/concerts/${slug}`);
  }
  // The listing pages changed too, and they're the ones that rank — but only the
  // ones we haven't just announced. Hubs first, so that if the list has to be cut it
  // loses the tail of a big batch of events rather than the pages those events
  // appear on.
  const listings = ['/', ...cities];
  const fresh = unannounced(listings, await announcedSince(db, hoursAgoIso(LISTING_TTL_HOURS)));
  const paths = [...fresh, ...rows.map((r) => `/event/${r.id}`)];
  const sent = [...new Set(paths)].slice(0, MAX_URLS);
  const urlList = sent.map((p) => origin + p);
  // What to write to the log is derived from what actually went in the payload, not
  // from what we hoped to send. Listings come first and there are only ever ~1,700
  // of them, so the cap should never reach one — but recording a path the slice
  // dropped would hide that page for a day without anyone having been told.
  const announced = new Set(sent);
  const recorded = fresh.filter((p) => announced.has(p));
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${origin}/${key}.txt`,
      urlList,
    }),
    // This runs at the end of the cron invocation the crawl already spent most of.
    // A ping nobody is waiting for must not be what runs it out of time.
    signal: AbortSignal.timeout(10_000),
  });

  // Non-fatal by design — but a rejected key or a malformed host is a silent
  // "nothing was ever submitted", so it goes in the log as a warning, not a stat.
  if (!res.ok) {
    console.warn(`indexnow: ${res.status} ${res.statusText} for ${urlList.length} URLs`);
  }

  // Recorded on 429 as well as on success, which is the opposite of what this did
  // first — and the first version deadlocked. The whole point of the throttle is to
  // stop re-announcing listing pages, but "only record what was accepted" means a
  // host that is being refused *for* re-announcing never builds up the log, so the
  // throttle it needs can never engage: every run resends the same hubs, gets 429,
  // records nothing, repeat. Observed exactly that — `skipped: 0, status: 429`.
  //
  // 429 is "you have told me too often". Whether those URLs were queued or dropped,
  // the correct response to it is to back off, and backing off is what writing the
  // row does. Other failures (403 on a bad key, 422 on a bad host) are a different
  // problem and are left to retry next run.
  //
  // Written after the POST rather than claimed before it. Two invocations overlapping
  // — a crawl that runs past its 15-minute slot — could then both pick the same hub
  // and announce it twice. That is one duplicate against the 96-a-day this replaces,
  // and a claim taken up front has to be released when the submission fails; an
  // isolate that dies mid-flight would leave the page unannounced for a day with
  // nothing to show why.
  if (recordsOn(res.status)) {
    await recordAnnounced(db, recorded, nowIso());
  }

  return {
    submitted: urlList.length,
    events: rows.length,
    cities: cities.size,
    skipped: listings.length - fresh.length,
    status: res.status,
  };
}
