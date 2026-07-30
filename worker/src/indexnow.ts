import { and, gte, sql } from 'drizzle-orm';

import { citySlug } from './cities';
import { getDb } from './db';
import type { Env } from './env';
import { events, venues } from './schema';

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

export type IndexNowResult = {
  submitted: number;
  events: number;
  cities: number;
  status: number;
};

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';

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
  if (!key || !host) return null;
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

  if (rows.length === 0) return null;

  const origin = `https://${host}`;
  const cities = new Set<string>();
  for (const r of rows) {
    if (!r.city?.trim()) continue;
    // Empty slug means the town has no hub page; don't submit `/concerts/`.
    const slug = citySlug(r.city, r.region, r.country);
    if (slug) cities.add(`/concerts/${slug}`);
  }
  // The listing pages changed too, and they're the ones that rank. Hubs first, so
  // that if the list has to be cut it loses the tail of a big batch of events
  // rather than the pages those events appear on.
  const paths = ['/', ...cities, ...rows.map((r) => `/event/${r.id}`)];
  const urlList = [...new Set(paths)].slice(0, MAX_URLS).map((p) => origin + p);
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${origin}/${key}.txt`,
      urlList,
    }),
  });

  return { submitted: urlList.length, events: rows.length, cities: cities.size, status: res.status };
}
