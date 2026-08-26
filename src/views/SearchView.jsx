import React, { useEffect, useRef, useState } from "react";
import { Modal, Stars } from "../ui.jsx";
import { searchMulti, movieDetails, tvDetails, img } from "../tmdb.js";
import {
  addMovieFromTmdb,
  addShowFromTmdb,
  markItemWatched,
  inLibrary,
} from "../libops.js";

// Query + results survive view switches — search is a place, not a popup.
let cache = { q: "", results: [] };

export default function SearchView({ lib, update, notify }) {
  const [q, setQ] = useState(cache.q);
  const [results, setResults] = useState(cache.results);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);
  const [openResult, setOpenResult] = useState(null);
  const timer = useRef(null);
  const inputRef = useRef(null);
  const firstRun = useRef(true);
  const key = lib.settings?.tmdbKey;

  useEffect(() => {
    cache = { q, results };
  }, [q, results]);

  // ⌘K / ＋ Add re-focus the input even when the view is already open.
  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("wv-focus-search", focus);
    return () => window.removeEventListener("wv-focus-search", focus);
  }, []);

  useEffect(() => {
    // Don't re-fetch on mount when we're restoring cached results.
    if (firstRun.current) {
      firstRun.current = false;
      if (results.length) return;
    }
    if (!key || q.trim().length < 2) {
      setResults([]);
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setBusy(true);
      try {
        setResults(await searchMulti(key, q.trim()));
      } catch (e) {
        notify(`Search failed: ${String(e).slice(0, 120)}`);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, key]);

  // Adding never closes or resets anything — the row just flips to
  // "In library" and you keep going.
  async function quickAdd(r) {
    setAdding(r.id);
    try {
      const { title } =
        r.media_type === "movie"
          ? await addMovieFromTmdb(update, key, r.id)
          : await addShowFromTmdb(update, key, r.id);
      notify(`Added “${title}” to ${r.media_type === "movie" ? "Movies" : "TV Shows"}`);
    } catch (e) {
      notify(`Could not add: ${String(e).slice(0, 120)}`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <div className="search-page">
      <input
        ref={inputRef}
        className="search-big"
        autoFocus
        placeholder={
          key
            ? "Search TMDB for movies and TV shows… (⌘K from anywhere)"
            : "Add your TMDB API key in Settings to search"
        }
        disabled={!key}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {busy && <div className="empty">Searching…</div>}
      {!busy && q.trim().length >= 2 && results.length === 0 && (
        <div className="empty">No results.</div>
      )}
      {!busy && !results.length && q.trim().length < 2 && (
        <div className="empty">
          Type at least two characters. Click any result for details, stars and
          “watched” logging — add as many titles as you like, nothing closes.
        </div>
      )}
      <div className="search-page-results">
        {results.map((r) => {
          const title = r.media_type === "movie" ? r.title : r.name;
          const date = r.media_type === "movie" ? r.release_date : r.first_air_date;
          const inLib = inLibrary(lib, r.media_type, r.id);
          return (
            <div
              className="result-row"
              key={`${r.media_type}-${r.id}`}
              style={{ cursor: "pointer" }}
              onClick={() => setOpenResult(r)}
            >
              {r.poster_path ? (
                <img src={img(r.poster_path, "w92")} alt="" />
              ) : (
                <span className="mini-poster">no poster</span>
              )}
              <div className="r-info">
                <div className="r-title">{title}</div>
                <div className="r-sub">
                  {r.media_type === "movie" ? "Movie" : "TV show"}
                  {date ? ` · ${date.slice(0, 4)}` : ""}
                  {r.vote_average ? ` · ★ ${r.vote_average.toFixed(1)}` : ""}
                </div>
                {r.overview && <div className="r-overview">{r.overview}</div>}
              </div>
              <button
                className="btn small"
                disabled={inLib || adding === r.id}
                onClick={(e) => {
                  e.stopPropagation();
                  quickAdd(r);
                }}
              >
                {inLib ? "✓ In library" : adding === r.id ? "Adding…" : "＋ Add"}
              </button>
            </div>
          );
        })}
      </div>
      {openResult && (
        <ResultDetail
          r={openResult}
          lib={lib}
          update={update}
          notify={notify}
          onClose={() => setOpenResult(null)}
        />
      )}
    </div>
  );
}

// Full detail sheet: info + add-to-watchlist or log-as-watched (date + stars).
// Closing it returns to the results, which are still there.
function ResultDetail({ r, lib, update, notify, onClose }) {
  const key = lib.settings?.tmdbKey;
  const isMovie = r.media_type === "movie";
  const title = isMovie ? r.title : r.name;
  const [det, setDet] = useState(null);
  const [rating, setRating] = useState(0);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(null); // "watch" | "list" | null
  const today = new Date().toISOString().slice(0, 10);
  const inLib = inLibrary(lib, r.media_type, r.id);

  useEffect(() => {
    let live = true;
    (isMovie ? movieDetails(key, r.id) : tvDetails(key, r.id))
      .then((d) => live && setDet(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [r.id, isMovie, key]);

  async function addItem() {
    return isMovie
      ? { kind: "movie", ...(await addMovieFromTmdb(update, key, r.id)) }
      : { kind: "show", ...(await addShowFromTmdb(update, key, r.id)) };
  }

  async function addToWatchlist() {
    setBusy("list");
    try {
      const { title: t } = await addItem();
      notify(`Added “${t}” to your watchlist`);
      onClose();
    } catch (e) {
      notify(`Could not add: ${String(e).slice(0, 120)}`);
      setBusy(null);
    }
  }

  async function addAsWatched() {
    setBusy("watch");
    try {
      const { kind, uuid, title: t } = await addItem();
      const dateIso = new Date(`${date}T12:00:00`).toISOString();
      markItemWatched(update, kind, uuid, { dateIso, rating: rating || null });
      notify(
        `“${t}” logged as watched${rating ? ` · ★ ${rating}` : ""}${
          isMovie ? "" : " (all aired episodes)"
        }`
      );
      onClose();
    } catch (e) {
      notify(`Could not add: ${String(e).slice(0, 120)}`);
      setBusy(null);
    }
  }

  const backdrop = r.backdrop_path ? img(r.backdrop_path, "w780") : null;
  const facts = [
    (isMovie ? r.release_date : r.first_air_date)?.slice(0, 4),
    isMovie
      ? det?.runtime
        ? `${det.runtime} min`
        : null
      : det
        ? `${det.number_of_seasons} season${det.number_of_seasons === 1 ? "" : "s"} · ${det.number_of_episodes} episodes`
        : null,
    !isMovie ? det?.status : null,
    r.vote_average ? `★ ${r.vote_average.toFixed(1)} on TMDB` : null,
  ].filter(Boolean);

  return (
    <Modal onClose={onClose} title={r.title || r.name}>
      <div
        className="backdrop"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : { height: 90 }}
      />
      <div className="body">
        <div className="poster-col">
          <div className="poster" style={{ borderRadius: 10, overflow: "hidden" }}>
            {r.poster_path ? (
              <img src={img(r.poster_path, "w342")} alt={title} />
            ) : (
              <div className="fallback">
                <span>{title}</span>
              </div>
            )}
          </div>
        </div>
        <div className="meta-col">
          <h2>{title}</h2>
          <div className="subline">{facts.join(" · ")}</div>
          {det?.genres?.length ? (
            <div className="genres">
              {det.genres.map((g) => (
                <span key={g.id}>{g.name}</span>
              ))}
            </div>
          ) : null}
          <p className="overview">
            {r.overview || det?.overview || "No description available."}
          </p>
          {inLib ? (
            <p className="hint">Already in your library.</p>
          ) : (
            <>
              <div className="actions" style={{ alignItems: "center" }}>
                <label style={{ fontSize: 13, color: "var(--ink-2)" }}>
                  Watched on{" "}
                  <input
                    type="date"
                    value={date}
                    max={today}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </label>
                <Stars value={rating} onChange={(v) => setRating(v || 0)} />
              </div>
              <div className="actions" style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={!!busy} onClick={addAsWatched}>
                  {busy === "watch"
                    ? "Logging…"
                    : `✓ Add as watched${rating ? ` · ★ ${rating}` : ""}`}
                </button>
                <button className="btn" disabled={!!busy} onClick={addToWatchlist}>
                  {busy === "list" ? "Adding…" : "＋ Add to watchlist"}
                </button>
              </div>
              {!isMovie && (
                <p className="hint" style={{ marginTop: 8 }}>
                  “Add as watched” marks every aired episode on that date (kept
                  out of time charts as logged history).
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
