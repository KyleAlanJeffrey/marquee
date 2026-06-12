// Spotify artist search proxy.
// The app can't hold Spotify credentials, so this function exchanges
// client-credentials for a token (cached for its lifetime) and forwards
// the search. Secrets: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.value;
  }
  const id = Deno.env.get("SPOTIFY_CLIENT_ID");
  const secret = Deno.env.get("SPOTIFY_CLIENT_SECRET");
  if (!id || !secret) throw new Error("Spotify credentials not configured");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Spotify token request failed: ${res.status}`);
  const json = await res.json();
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.value;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return new Response(JSON.stringify({ error: "query is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = await getSpotifyToken();
    const res = await fetch(
      `https://api.spotify.com/v1/search?type=artist&limit=15&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Spotify search failed: ${res.status}`);
    const json = await res.json();

    const artists = (json.artists?.items ?? []).map((a: any) => ({
      spotify_id: a.id,
      name: a.name,
      image_url: a.images?.[0]?.url ?? null,
      genres: a.genres ?? [],
      popularity: a.popularity ?? 0,
    }));

    return new Response(JSON.stringify({ artists }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
