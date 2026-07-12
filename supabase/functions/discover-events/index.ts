// On-demand discovery: given the caller's location, pull nearby music events
// from Ticketmaster and upsert them. Rate-limited per coarse grid cell so the
// same area isn't re-fetched constantly. Called by the app (anon JWT) when the
// Near Me feed is thin.

import {
  admin,
  corsHeaders,
  EventInput,
  persist,
  TM_KEY,
  tmEventsNear,
  tmToEventInput,
  upsertTmArtist,
} from "../_shared/ingest.ts";

const FRESH_HOURS = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const { lat, lng, radius = 50 } = await req.json();
    if (typeof lat !== "number" || typeof lng !== "number") {
      return json({ error: "lat and lng are required numbers" }, 400);
    }
    if (!TM_KEY) return json({ error: "TICKETMASTER_API_KEY not configured", ingested: 0 }, 200);

    const supabase = admin();

    // Throttle: skip if this ~11km cell was fetched within FRESH_HOURS.
    const cell = `${lat.toFixed(1)},${lng.toFixed(1)},${Math.round(radius)}`;
    const { data: log } = await supabase
      .from("discovery_log")
      .select("fetched_at")
      .eq("cell", cell)
      .maybeSingle();
    if (log && Date.now() - new Date(log.fetched_at).getTime() < FRESH_HOURS * 3600_000) {
      return json({ skipped: true, reason: "recently fetched", ingested: 0 });
    }

    const events = await tmEventsNear(lat, lng, radius);
    const inputs: EventInput[] = [];
    for (const e of events) {
      const artistId = await upsertTmArtist(supabase, e._embedded?.attractions?.[0]);
      if (!artistId) continue;
      const input = tmToEventInput(e, artistId);
      if (input) inputs.push(input);
    }
    const newIds = await persist(supabase, inputs);

    await supabase
      .from("discovery_log")
      .upsert({ cell, fetched_at: new Date().toISOString() }, { onConflict: "cell" });

    return json({ ingested: newIds.length, scanned: events.length });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
