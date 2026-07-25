// Shared library operations: adding titles from TMDB (used by search & discover).

import { movieDetails, tvDetails, fetchAllSeasons, movieMeta, tvMeta } from "./tmdb.js";
import { isCanonEpisode, isAiredEpisode } from "./ui.jsx";

export async function addMovieFromTmdb(update, key, tmdbId) {
  const det = await movieDetails(key, tmdbId);
  const meta = movieMeta(det);
  const uuid = crypto.randomUUID();
  update((next) => {
    next.movies.push({
      uuid,
      title: det.title,
      year: det.release_date ? Number(det.release_date.slice(0, 4)) : null,
      imdb: meta.imdb,
      tvdb: null,
      isWatched: false,
      watchedAt: null,
      isFavorite: false,
      rewatchCount: 0,
      rating: null,
      createdAt: new Date().toISOString(),
      meta,
    });
  });
  return { uuid, title: det.title };
}

export async function addShowFromTmdb(update, key, tmdbId) {
  const det = await tvDetails(key, tmdbId);
  const seasons = await fetchAllSeasons(key, tmdbId, det.seasons);
  const meta = tvMeta(det);
  const uuid = crypto.randomUUID();
  update((next) => {
    next.shows.push({
      uuid,
      title: det.name,
      imdb: meta.imdb,
      tvdb: meta.tvdb,
      status: null,
      isFavorite: false,
      rating: null,
      createdAt: new Date().toISOString(),
      meta,
      seasons,
    });
  });
  return { uuid, title: det.name };
}

// Marks a just-added (or existing) item fully watched on a given date, with an
// optional star rating. For shows this logs every aired episode as bulk
// history so time charts stay clean.
export function markItemWatched(update, kind, uuid, { dateIso, rating }) {
  update((next) => {
    if (kind === "movie") {
      const m = next.movies.find((x) => x.uuid === uuid);
      if (!m) return;
      m.isWatched = true;
      m.watchedAt = dateIso;
      if (rating) m.rating = rating;
    } else {
      const s = next.shows.find((x) => x.uuid === uuid);
      if (!s) return;
      if (rating) s.rating = rating;
      for (const se of s.seasons) {
        for (const e of se.episodes) {
          if (!isCanonEpisode(se, e)) continue;
          if (isAiredEpisode(e) && !e.isWatched) {
            e.isWatched = true;
            e.watchedAt = dateIso;
            e.bulk = true;
          }
        }
      }
    }
  });
}

export function inLibrary(lib, mediaType, tmdbId) {
  if (mediaType === "movie") return lib.movies.some((m) => m.meta?.tmdbId === tmdbId);
  return lib.shows.some((s) => s.meta?.tmdbId === tmdbId);
}
