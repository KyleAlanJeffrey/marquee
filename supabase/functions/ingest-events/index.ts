// Nightly ingestion + notification job.
//
// 1. Pull upcoming events for every followed artist (Ticketmaster + Bandsintown).
// 2. Pull discovery events around every user metro (Ticketmaster lat/long search).
// 3. Upsert venues/events; events are keyed on (source, source_event_id), so
//    inserts with ignoreDuplicates tell us exactly which events are NEW.
// 4. Push-notify followers whose home location is within their notify radius
//    of a new event's venue, then stamp notified_at.
//
// Called by pg_cron (see supabase/schedule.sql) with an `x-cron-secret` header.
// Secrets: CRON_SECRET, TICKETMASTER_API_KEY, BANDSINTOWN_APP_ID (optional).

import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const TM_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const BIT_APP_ID = Deno.env.get("BANDSINTOWN_APP_ID");
const TM_BASE = "https://app.ticketmaster.com/discovery/v2";

type VenueRow = {
  source: string;
  source_venue_id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  location: string | null; // WKT, e.g. "POINT(lng lat)"
};

type EventInput = {
  source: string;
  source_event_id: string;
  name: string;
  starts_at: string;
  ticket_url: string | null;
  artist_id: string;
  venue: VenueRow | null;
};

function wktPoint(lng: number | null, lat: number | null): string | null {
  if (lng == null || lat == null || isNaN(lng) || isNaN(lat)) return null;
  return `POINT(${lng} ${lat})`;
}

// --- Ticketmaster ----------------------------------------------------------

function tmVenue(e: any): VenueRow | null {
  const v = e._embedded?.venues?.[0];
  if (!v) return null;
  return {
    source: "ticketmaster",
    source_venue_id: v.id,
    name: v.name ?? "Unknown venue",
    city: v.city?.name ?? null,
    region: v.state?.stateCode ?? v.state?.name ?? null,
    country: v.country?.countryCode ?? null,
    location: wktPoint(
      parseFloat(v.location?.longitude),
      parseFloat(v.location?.latitude),
    ),
  };
}

async function tmFetch(path: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ ...params, apikey: TM_KEY! });
  const res = await fetch(`${TM_BASE}/${path}?${qs}`);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    return tmFetch(path, params);
  }
  if (!res.ok) throw new Error(`Ticketmaster ${path}: ${res.status}`);
  return res.json();
}

async function tmResolveAttractionId(artistName: string): Promise<string | null> {
  const json = await tmFetch("attractions.json", {
    keyword: artistName,
    classificationName: "music",
    size: "5",
  });
  const hit = (json._embedded?.attractions ?? []).find(
    (a: any) => a.name?.toLowerCase() === artistName.toLowerCase(),
  );
  return hit?.id ?? null;
}

async function tmEventsForAttraction(attractionId: string): Promise<any[]> {
  const json = await tmFetch("events.json", {
    attractionId,
    size: "100",
    sort: "date,asc",
  });
  return json._embedded?.events ?? [];
}

async function tmEventsNear(lat: number, lng: number): Promise<any[]> {
  const json = await tmFetch("events.json", {
    latlong: `${lat},${lng}`,
    radius: "75",
    unit: "miles",
    classificationName: "music",
    size: "200",
    sort: "date,asc",
  });
  return json._embedded?.events ?? [];
}

function tmToEventInput(e: any, artistId: string): EventInput | null {
  const startsAt = e.dates?.start?.dateTime;
  if (!startsAt) return null; // skip TBA dates
  return {
    source: "ticketmaster",
    source_event_id: e.id,
    name: e.name,
    starts_at: startsAt,
    ticket_url: e.url ?? null,
    artist_id: artistId,
    venue: tmVenue(e),
  };
}

// --- Bandsintown ------------------------------------------------------------

async function bitEventsForArtist(artist: {
  id: string;
  name: string;
  bandsintown_name: string | null;
}): Promise<EventInput[]> {
  if (!BIT_APP_ID) return [];
  const name = artist.bandsintown_name ?? artist.name;
  const res = await fetch(
    `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${BIT_APP_ID}&date=upcoming`,
  );
  if (!res.ok) return []; // unknown artist on BIT is normal
  const events = await res.json();
  if (!Array.isArray(events)) return [];
  return events.flatMap((e: any) => {
    if (!e.datetime || !e.id) return [];
    const lat = parseFloat(e.venue?.latitude);
    const lng = parseFloat(e.venue?.longitude);
    return [{
      source: "bandsintown",
      source_event_id: String(e.id),
      name: e.title || `${artist.name} @ ${e.venue?.name ?? "TBA"}`,
      starts_at: new Date(e.datetime).toISOString(),
      ticket_url: e.offers?.[0]?.url ?? e.url ?? null,
      artist_id: artist.id,
      venue: e.venue
        ? {
            source: "bandsintown",
            source_venue_id: String(e.venue.id ?? `${e.venue.name}-${e.venue.city}`),
            name: e.venue.name ?? "Unknown venue",
            city: e.venue.city ?? null,
            region: e.venue.region ?? null,
            country: e.venue.country ?? null,
            location: wktPoint(lng, lat),
          }
        : null,
    }];
  });
}

// --- Persistence ------------------------------------------------------------

// Upsert venues, then insert events that we haven't seen before.
// Returns the ids of newly inserted events.
async function persist(inputs: EventInput[]): Promise<string[]> {
  if (inputs.length === 0) return [];

  const venues = new Map<string, VenueRow>();
  for (const i of inputs) {
    if (i.venue) venues.set(`${i.venue.source}:${i.venue.source_venue_id}`, i.venue);
  }

  const venueIdByKey = new Map<string, string>();
  if (venues.size > 0) {
    const { data, error } = await supabase
      .from("venues")
      .upsert([...venues.values()], { onConflict: "source,source_venue_id" })
      .select("id, source, source_venue_id");
    if (error) throw error;
    for (const v of data) venueIdByKey.set(`${v.source}:${v.source_venue_id}`, v.id);
  }

  const eventRows = inputs.map((i) => ({
    source: i.source,
    source_event_id: i.source_event_id,
    name: i.name,
    starts_at: i.starts_at,
    ticket_url: i.ticket_url,
    artist_id: i.artist_id,
    venue_id: i.venue
      ? venueIdByKey.get(`${i.venue.source}:${i.venue.source_venue_id}`) ?? null
      : null,
  }));

  // ignoreDuplicates => ON CONFLICT DO NOTHING => returned rows are the new ones
  const { data, error } = await supabase
    .from("events")
    .upsert(eventRows, {
      onConflict: "source,source_event_id",
      ignoreDuplicates: true,
    })
    .select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

// Upsert a discovery artist seen in a Ticketmaster metro sweep.
async function upsertTmArtist(attraction: any): Promise<string | null> {
  if (!attraction?.id || !attraction?.name) return null;
  const { data, error } = await supabase
    .from("artists")
    .upsert(
      {
        ticketmaster_id: attraction.id,
        name: attraction.name,
        image_url: attraction.images?.[0]?.url ?? null,
        genres: (attraction.classifications ?? [])
          .map((c: any) => c.genre?.name)
          .filter((g: string) => g && g !== "Undefined"),
      },
      { onConflict: "ticketmaster_id" },
    )
    .select("id")
    .single();
  if (error) {
    console.error(`artist upsert failed for ${attraction.name}: ${error.message}`);
    return null;
  }
  return data.id;
}

// --- Notifications ----------------------------------------------------------

async function notifyFollowers(newEventIds: string[]) {
  if (newEventIds.length === 0) return 0;

  const { data: targets, error } = await supabase.rpc("followers_to_notify", {
    p_event_ids: newEventIds,
  });
  if (error) throw error;

  const messages = (targets ?? []).map((t: any) => ({
    to: t.expo_push_token,
    title: `${t.artist_name} is coming to ${t.venue_city ?? "your area"}!`,
    body: `${new Date(t.starts_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    })} at ${t.venue_name ?? "TBA"}. Tap for tickets.`,
    data: { eventId: t.event_id, artistId: t.artist_id },
  }));

  for (let i = 0; i < messages.length; i += 100) {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages.slice(i, i + 100)),
    });
    if (!res.ok) console.error(`expo push batch failed: ${res.status}`);
  }

  await supabase
    .from("events")
    .update({ notified_at: new Date().toISOString() })
    .in("id", newEventIds);

  return messages.length;
}

// --- Handler -----------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  if (!TM_KEY) {
    return new Response("TICKETMASTER_API_KEY not configured", { status: 500 });
  }

  const stats = { artists: 0, metros: 0, newEvents: 0, pushes: 0 };

  try {
    // 1. Events for followed artists
    const { data: followed, error: artistsErr } = await supabase
      .from("artists")
      .select("id, name, ticketmaster_id, bandsintown_name, follows!inner(user_id)");
    if (artistsErr) throw artistsErr;

    const newIds: string[] = [];
    for (const artist of followed ?? []) {
      stats.artists++;
      try {
        let tmId = artist.ticketmaster_id;
        if (!tmId) {
          tmId = await tmResolveAttractionId(artist.name);
          if (tmId) {
            await supabase.from("artists").update({ ticketmaster_id: tmId }).eq("id", artist.id);
          }
        }
        const inputs: EventInput[] = [];
        if (tmId) {
          const events = await tmEventsForAttraction(tmId);
          inputs.push(...events.flatMap((e) => tmToEventInput(e, artist.id) ?? []));
        }
        inputs.push(...(await bitEventsForArtist(artist)));
        newIds.push(...(await persist(inputs)));
      } catch (err) {
        console.error(`ingest failed for artist ${artist.name}: ${err}`);
      }
    }

    // 2. Discovery events around each user metro
    const { data: metros, error: metroErr } = await supabase.rpc("user_metros");
    if (metroErr) throw metroErr;
    for (const metro of metros ?? []) {
      stats.metros++;
      try {
        const events = await tmEventsNear(metro.lat, metro.lng);
        const inputs: EventInput[] = [];
        for (const e of events) {
          const artistId = await upsertTmArtist(e._embedded?.attractions?.[0]);
          if (!artistId) continue;
          const input = tmToEventInput(e, artistId);
          if (input) inputs.push(input);
        }
        newIds.push(...(await persist(inputs)));
      } catch (err) {
        console.error(`metro ingest failed (${metro.lat},${metro.lng}): ${err}`);
      }
    }

    // 3. Notify followers about genuinely new events
    stats.newEvents = newIds.length;
    stats.pushes = await notifyFollowers(newIds);

    return new Response(JSON.stringify(stats), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err), stats }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
