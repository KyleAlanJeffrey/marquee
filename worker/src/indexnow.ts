import { and, gte, sql } from 'drizzle-orm';

import { citySlug } from './cities';
import { stillUpcoming } from './data';
import type { DB } from './db';
import { getDb } from './db';
import type { Env } from './env';
import { events, indexnowLog, ingestRuns, venues } from './schema';

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
 * `/` and the city hubs do change whenever a show is added, which is most runs, but
 * a crawler does not need telling 96 times a day. Holding them for a day is politeness
 * and less pointless traffic. Event URLs are exempt: each is a page that did not exist
 * an hour ago, which is the thing the protocol is for.
 *
 * This is NOT the fix for the 429s, though it was written believing it was. Measured
 * against the live endpoint, payload composition turned out to be irrelevant — from a
 * home IP, `/` alone, three hubs that had been announced ~96 times a day for days, and
 * a reconstructed 154-URL cron payload (root + 50 hubs + 103 events) all returned 200,
 * while the Worker's own 153-URL payload was refused minutes earlier. Every
 * CLI-originated request succeeded; every Worker-originated one failed. What is left
 * after content, size and repetition are ruled out is the origin of the request, which
 * points at a per-IP limit on Cloudflare's shared Worker egress addresses — plausibly
 * because a great many Workers submit to IndexNow from them.
 *
 * Nothing in this file can fix that. See README for what actually can.
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

/**
 * Keep the outcome where it can be queried later.
 *
 * `console.log` is not a record. Chasing the 429 meant catching a cron in
 * `wrangler tail`, and tail *samples*: at 3,442 events in a window it dropped the
 * invocation entirely twice, so the same run had to be waited for three times over.
 * `ingest_runs` exists for exactly this reason — see migration 0006, where a source
 * whose key went missing kept "succeeding" invisibly — and a submission that is being
 * refused is the same class of silence.
 */
async function recordRun(db: DB, startedAt: string, r: IndexNowResult): Promise<void> {
  await db.insert(ingestRuns).values({
    id: crypto.randomUUID(),
    source: 'indexnow',
    kind: 'indexnow',
    startedAt,
    finishedAt: nowIso(),
    scanned: r.submitted,
    inserted: r.events,
    // A refused submission announced nothing, whatever the URL count says.
    failed: r.status >= 300 ? r.submitted : 0,
    note: `${r.status} cities=${r.cities} skipped=${r.skipped}`,
  });
}

/**
 * Record a run that submitted nothing, and why.
 *
 * The reason this is not just a `console.log`: "key not bound" and "nothing new to
 * announce" both used to return quietly, which made them indistinguishable — and
 * that is precisely how the unbound key went unnoticed for a day. A row per hour
 * on a misconfigured deploy is the signal, not noise.
 *
 * Never throws. This is bookkeeping at the tail of a cron invocation that has
 * already done the crawl; it must not be what fails the run.
 */
async function recordNoop(db: DB, startedAt: string, reason: string): Promise<void> {
  try {
    await db.insert(ingestRuns).values({
      id: crypto.randomUUID(),
      source: 'indexnow',
      kind: 'indexnow',
      startedAt,
      finishedAt: nowIso(),
      scanned: 0,
      inserted: 0,
      failed: 0,
      note: `noop ${reason}`,
    });
  } catch (err) {
    console.warn('indexnow: could not record no-op run:', err);
  }
}

/** The paths in `candidates` that aren't in the recently-announced set. */
export function unannounced(candidates: string[], announced: Set<string>): string[] {
  return candidates.filter((p) => !announced.has(p));
}

/**
 * Whether a response status means "consider these announced".
 *
 * Success, obviously. And 429, because recording only successes deadlocks: while the
 * endpoint is refusing us, nothing is ever written, so nothing is ever skipped, so
 * every run resends the same listing pages forever. Observed in production as
 * `skipped: 0, status: 429` on consecutive runs, then `skipped: 27` once fixed.
 *
 * That the 429 has a different cause entirely (see `LISTING_TTL_HOURS`) does not change
 * this: a persistent refusal must not be able to pin the log empty.
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
  const db = getDb(env.DB);
  if (!key || !host) {
    const missing = !key ? 'INDEXNOW_KEY' : 'PRIMARY_HOST';
    console.log(`indexnow: off (${missing} not bound)`);
    await recordNoop(db, since, `${missing} not bound`);
    return null;
  }
  if (!KEY_SHAPE.test(key)) {
    console.warn('indexnow: INDEXNOW_KEY is not 8–128 of [A-Za-z0-9-]; skipping');
    await recordNoop(db, since, 'INDEXNOW_KEY malformed');
    return null;
  }

  const rows = await db
    .select({
      id: events.id,
      city: venues.city,
      region: venues.region,
      country: venues.country,
    })
    .from(events)
    .leftJoin(venues, sql`${venues.id} = ${events.venueId}`)
    .where(and(gte(events.createdAt, since), stillUpcoming()))
    .limit(MAX_URLS);

  if (rows.length === 0) {
    console.log('indexnow: nothing new to announce');
    await recordNoop(db, since, 'nothing new');
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

  // Recorded on 429 as well as on success — the opposite of what this did first, which
  // deadlocked: while the endpoint refuses us nothing is written, so nothing is skipped,
  // so the same listings go out every run forever. Observed as `skipped: 0, status: 429`
  // on consecutive runs, and `skipped: 27` after the fix.
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

  const result: IndexNowResult = {
    submitted: urlList.length,
    events: rows.length,
    cities: cities.size,
    skipped: listings.length - fresh.length,
    status: res.status,
  };
  await recordRun(db, since, result);
  return result;
}
