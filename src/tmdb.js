// Minimal TMDB (themoviedb.org) API v3 client.
// Accepts either a v3 API key or a v4 read-access token (starts with "eyJ").

const BASE = "https://api.themoviedb.org/3";

function isV4Token(key) {
  return key && key.startsWith("eyJ");
}

async function tm(key, path, params = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  const headers = { Accept: "application/json" };
  if (isV4Token(key)) headers.Authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);

  const res = await fetch(url, { headers });
  if (res.status === 429) {
    // Rate limited — wait and retry once.
    await new Promise((r) => setTimeout(r, 1500));
    return tm(key, path, params);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`TMDB ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function img(path, size = "w342") {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

export async function testKey(key) {
  await tm(key, "/configuration");
  return true;
}

// Look up a TMDB entry from an IMDB or TVDB id.
// kind: "movie" | "tv". Returns the TMDB result object or null.
export async function findByExternalId(key, { imdb, tvdb, kind }) {
  const bucket = kind === "movie" ? "movie_results" : "tv_results";
  if (imdb) {
    const r = await tm(key, `/find/${imdb}`, { external_source: "imdb_id" });
    if (r[bucket]?.length) return r[bucket][0];
  }
  if (tvdb) {
    const r = await tm(key, `/find/${tvdb}`, { external_source: "tvdb_id" });
    if (r[bucket]?.length) return r[bucket][0];
  }
  return null;
}

export async function movieDetails(key, id) {
  return tm(key, `/movie/${id}`);
}

export async function tvDetails(key, id) {
  return tm(key, `/tv/${id}`, { append_to_response: "external_ids" });
}

export async function seasonDetails(key, id, seasonNumber) {
  return tm(key, `/tv/${id}/season/${seasonNumber}`);
}

export async function recommendations(key, kind, id, page = 1) {
  const r = await tm(key, `/${kind}/${id}/recommendations`, { page });
  return r.results || [];
}

// Streaming availability (JustWatch data via TMDB). Returns provider names
// for one country, or empty lists if nothing is listed there.
export async function watchProviders(key, kind, id, country) {
  const r = await tm(key, `/${kind}/${id}/watch/providers`);
  const c = r.results?.[country];
  if (!c) return { flatrate: [], free: [] };
  return {
    flatrate: (c.flatrate || []).map((p) => p.provider_name),
    free: [...(c.free || []), ...(c.ads || [])].map((p) => p.provider_name),
  };
}

export async function searchMulti(key, query) {
  const r = await tm(key, "/search/multi", { query, include_adult: "false" });
  return (r.results || []).filter(
    (x) => x.media_type === "movie" || x.media_type === "tv"
  );
}

// --- Mapping helpers: TMDB responses → library `meta` objects ---

export function movieMeta(details) {
  return {
    tmdbId: details.id,
    poster: details.poster_path,
    backdrop: details.backdrop_path,
    overview: details.overview,
    runtime: details.runtime || null,
    genres: (details.genres || []).map((g) => g.name),
    releaseDate: details.release_date || null,
    imdb: details.imdb_id || null,
  };
}

export function tvMeta(details) {
  return {
    tmdbId: details.id,
    poster: details.poster_path,
    backdrop: details.backdrop_path,
    overview: details.overview,
    episodeRuntime: details.episode_run_time?.[0] || null,
    genres: (details.genres || []).map((g) => g.name),
    firstAirDate: details.first_air_date || null,
    statusText: details.status || null,
    totalEpisodes: details.number_of_episodes || null,
    imdb: details.external_ids?.imdb_id || null,
    tvdb: details.external_ids?.tvdb_id || null,
  };
}

// Build library seasons array from TMDB tv details (fetches every season).
export async function fetchAllSeasons(key, tmdbId, seasonList) {
  const seasons = [];
  for (const s of seasonList || []) {
    const det = await seasonDetails(key, tmdbId, s.season_number);
    seasons.push({
      number: s.season_number,
      isSpecials: s.season_number === 0,
      episodes: (det.episodes || []).map((e) => ({
        tvdb: null,
        imdb: null,
        tmdb: e.id,
        number: e.episode_number,
        name: e.name,
        special: s.season_number === 0,
        airDate: e.air_date || null,
        isWatched: false,
        watchedAt: null,
        rewatchCount: 0,
      })),
    });
  }
  return seasons;
}
