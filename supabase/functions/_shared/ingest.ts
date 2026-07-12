// Shared concert-ingestion core, used by the client-driven functions
// (discover-events, refresh-artist-events) and the legacy nightly job.
//
// All writes go through the service-role client, so these run server-side only.
// Secrets: TICKETMASTER_API_KEY, BANDSINTOWN_APP_ID (optional).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export const TM_KEY = Deno.env.get("TICKETMASTER_API_KEY");
const BIT_APP_ID = Deno.env.get("BANDSINTOWN_APP_ID");
const TM_BASE = "https://app.ticketmaster.com/discovery/v2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export type VenueRow = {
  source: string;
  source_venue_id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  location: string | null; // WKT "POINT(lng lat)"
};

export type EventInput = {
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

// --- Ticketmaster -----------------------------------------------------------

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
    location: wktPoint(parseFloat(v.location?.longitude), parseFloat(v.location?.latitude)),
  };
}

export async function tmFetch(path: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ ...params, apikey: TM_KEY! });
  const res = await fetch(`${TM_BASE}/${path}?${qs}`);
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    return tmFetch(path, params);
  }
  if (!res.ok) throw new Error(`Ticketmaster ${path}: ${res.status}`);
  return res.json();
}

export async function tmResolveAttractionId(artistName: string): Promise<string | null> {
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

export async function tmEventsForAttraction(attractionId: string): Promise<any[]> {
  const json = await tmFetch("events.json", { attractionId, size: "100", sort: "date,asc" });
  return json._embedded?.events ?? [];
}

export async function tmEventsNear(lat: number, lng: number, radiusMiles: number): Promise<any[]> {
  const json = await tmFetch("events.json", {
    latlong: `${lat},${lng}`,
    radius: String(Math.min(Math.max(Math.round(radiusMiles), 1), 150)),
    unit: "miles",
    classificationName: "music",
    size: "200",
    sort: "date,asc",
  });
  return json._embedded?.events ?? [];
}

export function tmToEventInput(e: any, artistId: string): EventInput | null {
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

export async function bitEventsForArtist(artist: {
  id: string;
  name: string;
  bandsintown_name: string | null;
}): Promise<EventInput[]> {
  if (!BIT_APP_ID) return [];
  const name = artist.bandsintown_name ?? artist.name;
  const res = await fetch(
    `https://rest.bandsintown.com/artists/${encodeURIComponent(name)}/events?app_id=${BIT_APP_ID}&date=upcoming`,
  );
  if (!res.ok) return [];
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

/** Upsert venues, insert unseen events; returns ids of newly inserted events. */
export async function persist(supabase: SupabaseClient, inputs: EventInput[]): Promise<string[]> {
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
    venue_id: i.venue ? venueIdByKey.get(`${i.venue.source}:${i.venue.source_venue_id}`) ?? null : null,
  }));

  const { data, error } = await supabase
    .from("events")
    .upsert(eventRows, { onConflict: "source,source_event_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw error;
  return (data ?? []).map((r) => r.id);
}

/** Upsert an artist discovered in a Ticketmaster sweep; returns its id. */
export async function upsertTmArtist(supabase: SupabaseClient, attraction: any): Promise<string | null> {
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
