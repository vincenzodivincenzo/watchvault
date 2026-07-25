// OMDb (omdbapi.com) client — community ratings by IMDB id.
// Free tier: 1,000 requests/day, more than enough for a whole library.

export async function omdbByImdb(key, imdbId) {
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(key)}&i=${encodeURIComponent(imdbId)}`;
  const res = await fetch(url);
  if (res.status === 401) throw new Error("OMDB 401: invalid API key");
  if (!res.ok) throw new Error(`OMDB ${res.status}`);
  const j = await res.json();
  if (j.Response === "False") return null; // title not in OMDb
  const ratings = {};
  for (const r of j.Ratings || []) {
    if (r.Source === "Internet Movie Database")
      ratings.imdb = parseFloat(r.Value) || null; // "8.4/10"
    if (r.Source === "Rotten Tomatoes")
      ratings.rt = parseInt(r.Value) || null; // "94%"
    if (r.Source === "Metacritic")
      ratings.mc = parseInt(r.Value) || null; // "74/100"
  }
  if (!ratings.imdb && j.imdbRating && j.imdbRating !== "N/A")
    ratings.imdb = parseFloat(j.imdbRating) || null;
  ratings.votes = j.imdbVotes && j.imdbVotes !== "N/A" ? j.imdbVotes : null;
  ratings.fetchedAt = new Date().toISOString();
  return ratings;
}

export async function testOmdbKey(key) {
  const r = await omdbByImdb(key, "tt0111161"); // The Shawshank Redemption
  if (!r) throw new Error("Unexpected empty OMDb response");
  return true;
}

// Fills item.omdb for every library item with an IMDB id and no data yet.
export function needsOmdb(lib) {
  const check = (x) => x.imdb && !x.omdb && !x.omdbFailed;
  return lib.movies.filter(check).length + lib.shows.filter(check).length;
}

export async function enrichOmdb(lib, key, { onItem, onProgress, signal }) {
  const check = (x) => x.imdb && !x.omdb && !x.omdbFailed;
  const queue = [
    ...lib.movies.filter(check).map((x) => ({ kind: "movie", item: x })),
    ...lib.shows.filter(check).map((x) => ({ kind: "show", item: x })),
  ];
  let remaining = queue.length;

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) return;
      const { kind, item } = queue.shift();
      try {
        const ratings = await omdbByImdb(key, item.imdb);
        onItem(kind, item.uuid, ratings ? { omdb: ratings } : { omdbFailed: true });
      } catch (e) {
        if (String(e).includes("401")) {
          queue.length = 0;
          throw e;
        }
        onItem(kind, item.uuid, { omdbFailed: true });
      }
      remaining--;
      onProgress?.(remaining);
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  await Promise.all(Array.from({ length: 3 }, worker));
}
