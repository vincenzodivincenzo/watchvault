// Background metadata enrichment: fills item.meta from TMDB for every
// library item that has external ids but no metadata yet.

import { findByExternalId, movieDetails, tvDetails, movieMeta, tvMeta } from "./tmdb.js";

export function needsEnrichment(lib) {
  const m = lib.movies.filter((x) => !x.meta && !x.metaFailed).length;
  const s = lib.shows.filter((x) => !x.meta && !x.metaFailed).length;
  return m + s;
}

// Runs until done or cancelled. Calls onItem(kind, uuid, patch) for each
// resolved item and onProgress(remaining) as it goes.
export async function enrichLibrary(lib, key, { onItem, onProgress, signal }) {
  const queue = [
    ...lib.movies.filter((x) => !x.meta && !x.metaFailed).map((x) => ({ kind: "movie", item: x })),
    ...lib.shows.filter((x) => !x.meta && !x.metaFailed).map((x) => ({ kind: "show", item: x })),
  ];
  let remaining = queue.length;
  const CONCURRENCY = 4;

  async function worker() {
    while (queue.length) {
      if (signal?.aborted) return;
      const { kind, item } = queue.shift();
      try {
        let patch = null;
        if (kind === "movie") {
          const found = await findByExternalId(key, { imdb: item.imdb, tvdb: null, kind: "movie" });
          if (found) {
            const det = await movieDetails(key, found.id);
            patch = { meta: movieMeta(det) };
          }
        } else {
          const found = await findByExternalId(key, { imdb: item.imdb, tvdb: item.tvdb, kind: "tv" });
          if (found) {
            const det = await tvDetails(key, found.id);
            patch = { meta: tvMeta(det) };
          }
        }
        if (!patch) patch = { metaFailed: true };
        onItem(kind, item.uuid, patch);
      } catch (e) {
        // Auth errors abort the whole run; transient errors mark and move on.
        if (String(e).includes("401")) {
          queue.length = 0;
          throw e;
        }
        onItem(kind, item.uuid, { metaFailed: true });
      }
      remaining--;
      onProgress?.(remaining);
      // Stay politely under TMDB rate limits.
      await new Promise((r) => setTimeout(r, 60));
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
