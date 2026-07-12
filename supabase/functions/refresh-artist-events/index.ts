// Refresh upcoming shows for a client-supplied set of followed artists. Since
// follows live on-device, the app POSTs its follow list here; we resolve each
// artist on Ticketmaster (+ Bandsintown) and ingest their dates. Called by the
// app (anon JWT).

import {
  admin,
  bitEventsForArtist,
  corsHeaders,
  EventInput,
  persist,
  TM_KEY,
  tmEventsForAttraction,
  tmResolveAttractionId,
  tmToEventInput,
} from "../_shared/ingest.ts";

type IncomingArtist = {
  artistId?: string | null;
  spotifyId?: string | null;
  name: string;
  imageUrl?: string | null;
  genres?: string[];
};

const MAX_ARTISTS = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { artists } = await req.json();
    if (!Array.isArray(artists) || artists.length === 0) {
      return json({ error: "artists array required", ingested: 0 }, 400);
    }
    if (!TM_KEY) return json({ error: "TICKETMASTER_API_KEY not configured", ingested: 0 }, 200);

    const supabase = admin();
    const newIds: string[] = [];

    for (const a of (artists as IncomingArtist[]).slice(0, MAX_ARTISTS)) {
      if (!a?.name) continue;
      try {
        const row = await ensureArtist(supabase, a);
        if (!row) continue;

        let tmId = row.ticketmaster_id as string | null;
        if (!tmId) {
          tmId = await tmResolveAttractionId(row.name);
          if (tmId) await supabase.from("artists").update({ ticketmaster_id: tmId }).eq("id", row.id);
        }

        const inputs: EventInput[] = [];
        if (tmId) {
          const events = await tmEventsForAttraction(tmId);
          inputs.push(...events.flatMap((e) => tmToEventInput(e, row.id) ?? []));
        }
        inputs.push(...(await bitEventsForArtist(row)));
        newIds.push(...(await persist(supabase, inputs)));
      } catch (err) {
        console.error(`refresh failed for ${a.name}: ${err}`);
      }
    }

    return json({ ingested: newIds.length });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

/** Resolve the incoming artist to a catalog row (create it if needed). */
async function ensureArtist(
  supabase: ReturnType<typeof admin>,
  a: IncomingArtist,
): Promise<{ id: string; name: string; ticketmaster_id: string | null; bandsintown_name: string | null } | null> {
  const cols = "id, name, ticketmaster_id, bandsintown_name";

  if (a.artistId) {
    const { data } = await supabase.from("artists").select(cols).eq("id", a.artistId).maybeSingle();
    if (data) return data;
  }

  if (a.spotifyId) {
    const { data, error } = await supabase
      .from("artists")
      .upsert(
        {
          spotify_id: a.spotifyId,
          name: a.name,
          image_url: a.imageUrl ?? null,
          genres: a.genres ?? [],
        },
        { onConflict: "spotify_id" },
      )
      .select(cols)
      .single();
    if (error) {
      console.error(`ensureArtist upsert failed for ${a.name}: ${error.message}`);
      return null;
    }
    return data;
  }

  return null;
}
