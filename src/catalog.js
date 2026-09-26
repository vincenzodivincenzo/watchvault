// The catalogue behind each shelf.
//
// Search is not a place in this app. Every shelf searches its own catalogue —
// Movies searches TMDB films, TV Shows searches TMDB series — and the results
// land underneath the shelf they belong to. That is why this module exists: it
// gives both the same shape, so one card component can draw a title you own and
// a title you don't.

import { useEffect, useState } from "react";
import { searchMovies, searchTv } from "./tmdb.js";

// A catalogue result normalised into the same shape a library item has, so
// <Poster> renders it without knowing where it came from. `raw` is
// kept for the add path, which needs the source's own fields.
function fromTmdb(r) {
  const isMovie = r.media_type === "movie";
  const date = isMovie ? r.release_date : r.first_air_date;
  return {
    id: `${r.media_type}-${r.id}`,
    kind: isMovie ? "movie" : "show",
    tmdbId: r.id,
    title: (isMovie ? r.title : r.name) || "Untitled",
    year: date ? Number(date.slice(0, 4)) : null,
    votes: r.vote_average || null,
    // Shaped like a library item's meta so Poster reads it directly.
    meta: { poster: r.poster_path, backdrop: r.backdrop_path, overview: r.overview },
    raw: r,
  };
}

export const CATALOG_SOURCE = {
  movie: "TMDB",
  show: "TMDB",
};

async function runSearch(kind, term, tmdbKey, signal) {
  if (kind === "movie") return (await searchMovies(tmdbKey, term, { signal })).map(fromTmdb);
  return (await searchTv(tmdbKey, term, { signal })).map(fromTmdb);
}

// The library item this result refers to, or undefined. Returning the item
// rather than a boolean is what lets the description card treat a result and
// an owned title as one thing: once this finds something, the sheet's buttons
// stop describing an add and start editing the real object.
export function findOwned(lib, entry) {
  const list = entry.kind === "movie" ? lib.movies : lib.shows;
  return (list || []).find((x) => x.meta?.tmdbId === entry.tmdbId);
}

// True when this result is already on the shelf. Owned results are dropped
// from the catalogue block rather than shown twice — the shelf above is
// already displaying that title, with your rating and progress on it.
export function ownsResult(lib, entry) {
  return !!findOwned(lib, entry);
}

/**
 * Debounced catalogue search for one shelf.
 *
 * Returns { term, results, busy, error, ready } where `ready` is false while
 * the query is too short or the shelf has no key — the caller renders nothing
 * at all in that case, so a shelf you are only filtering stays quiet.
 */
export function useCatalogSearch(kind, query, { tmdbKey } = {}) {
  const [state, setState] = useState({
    term: "",
    results: [],
    busy: false,
    error: null,
    ready: false,
  });

  useEffect(() => {
    const term = (query || "").trim();
    const usable = term.length >= 2 && !!tmdbKey;
    if (!usable) {
      setState({ term, results: [], busy: false, error: null, ready: false });
      return;
    }
    setState((s) => ({ ...s, term, busy: true, error: null, ready: true }));

    const controller = new AbortController();
    // One request per pause in typing, not one per keystroke.
    const t = setTimeout(async () => {
      try {
        const results = await runSearch(kind, term, tmdbKey, controller.signal);
        setState({ term, results, busy: false, error: null, ready: true });
      } catch (e) {
        if (e.name === "AbortError") return;
        setState({
          term,
          results: [],
          busy: false,
          error: String(e).slice(0, 140),
          ready: true,
        });
      }
    }, 320);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [kind, query, tmdbKey]);

  return state;
}
