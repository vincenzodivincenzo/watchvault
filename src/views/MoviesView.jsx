import React, { useEffect, useMemo, useState } from "react";
import { Poster, Modal, Stars, fmtDate, movieBadge, CommunityRatings, WatchDate } from "../ui.jsx";
import { img } from "../tmdb.js";

const SORTS = [
  { id: "watched_desc", label: "Recently watched", needsWatched: true },
  { id: "rating_desc", label: "My rating", needsWatched: true },
  { id: "community_desc", label: "Community rating" },
  { id: "added_desc", label: "Recently added" },
  { id: "title", label: "Title A–Z" },
  { id: "year_desc", label: "Year (newest)" },
  { id: "year_asc", label: "Year (oldest)" },
];

export default function MoviesView({ lib, query, update, pendingOpen, onPendingConsumed }) {
  // Filter & sort choices are remembered in the library file.
  const prefs = lib.settings?.viewPrefs?.movies || {};
  const [filter, setFilterState] = useState(prefs.filter || "all");
  const [sort, setSortState] = useState(prefs.sort || "watched_desc");
  const [openUuid, setOpenUuid] = useState(null);

  // The command palette can jump straight to a film's detail page.
  useEffect(() => {
    if (pendingOpen) {
      setOpenUuid(pendingOpen);
      onPendingConsumed?.();
    }
  }, [pendingOpen, onPendingConsumed]);

  const remember = (patch) =>
    update((next) => {
      if (!next.settings.viewPrefs) next.settings.viewPrefs = {};
      next.settings.viewPrefs.movies = {
        ...next.settings.viewPrefs.movies,
        ...patch,
      };
    });
  const setFilter = (f) => {
    setFilterState(f);
    remember({ filter: f });
  };
  const setSort = (s) => {
    setSortState(s);
    remember({ sort: s });
  };

  const counts = useMemo(() => {
    const watched = lib.movies.filter((m) => m.isWatched).length;
    return {
      all: lib.movies.length,
      watched,
      towatch: lib.movies.length - watched,
      favorites: lib.movies.filter((m) => m.isFavorite).length,
    };
  }, [lib.movies]);

  const FILTERS = [
    { id: "all", label: `All ${counts.all}` },
    { id: "watched", label: `Watched ${counts.watched}` },
    { id: "towatch", label: `To watch ${counts.towatch}` },
    { id: "favorites", label: `Favorites ${counts.favorites}` },
  ];

  // Watched-date and rating sorts make no sense for the unwatched list —
  // fall back visually without overwriting the remembered choice.
  const sortOptions = SORTS.filter((s) => !(filter === "towatch" && s.needsWatched));
  const effectiveSort = sortOptions.some((s) => s.id === sort) ? sort : "added_desc";

  const movies = useMemo(() => {
    let list = lib.movies;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    }
    if (filter === "watched") list = list.filter((m) => m.isWatched);
    if (filter === "towatch") list = list.filter((m) => !m.isWatched);
    if (filter === "favorites") list = list.filter((m) => m.isFavorite);
    const by = {
      watched_desc: (a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || ""),
      added_desc: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
      title: (a, b) => a.title.localeCompare(b.title),
      year_desc: (a, b) => (b.year || 0) - (a.year || 0),
      year_asc: (a, b) => (a.year || 9999) - (b.year || 9999),
      rating_desc: (a, b) => (b.rating || 0) - (a.rating || 0),
      community_desc: (a, b) => (b.omdb?.imdb || 0) - (a.omdb?.imdb || 0),
    }[effectiveSort] || ((a, b) => a.title.localeCompare(b.title));
    return [...list].sort(by);
  }, [lib.movies, query, filter, effectiveSort]);

  const open = openUuid ? lib.movies.find((m) => m.uuid === openUuid) : null;

  function patch(uuid, fn) {
    update((next) => {
      const m = next.movies.find((x) => x.uuid === uuid);
      if (m) fn(m);
    });
  }

  function remove(uuid) {
    update((next) => {
      next.movies = next.movies.filter((x) => x.uuid !== uuid);
    });
  }

  return (
    <>
      <div className="chips">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={`chip ${filter === f.id ? "active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span className="sort">
          Sort
          <select value={effectiveSort} onChange={(e) => setSort(e.target.value)}>
            {sortOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {movies.length === 0 ? (
        <div className="empty">No movies match this filter.</div>
      ) : (
        <div className="poster-grid">
          {movies.map((m) => (
            <div className="card" key={m.uuid} onClick={() => setOpenUuid(m.uuid)}>
              <Poster item={m} badge={movieBadge(m)} />
              <div className="info">
                <div className="title">{m.title}</div>
                <div className="sub">
                  <span>{m.year || "—"}</span>
                  {m.rating ? <span>★ {m.rating}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <MovieDetail
          movie={open}
          patch={patch}
          onRemove={remove}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </>
  );
}

function MovieDetail({ movie, patch, onRemove, onClose }) {
  const m = movie;
  const backdrop = m.meta?.backdrop ? img(m.meta.backdrop, "w780") : null;
  return (
    <Modal onClose={onClose} title={movie.title}>
      <div
        className="backdrop"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : { height: 90 }}
      />
      <div className="body">
        <div className="poster-col">
          <Poster item={m} badge={movieBadge(m)} />
        </div>
        <div className="meta-col">
          <h2>{m.title}</h2>
          <div className="subline">
            {[
              m.year,
              m.meta?.runtime ? `${m.meta.runtime} min` : null,
              m.isWatched && m.watchedAt ? (
                <React.Fragment key="watched">
                  Watched{" "}
                  <WatchDate
                    iso={m.watchedAt}
                    onChange={(iso) => patch(m.uuid, (x) => (x.watchedAt = iso))}
                  />
                </React.Fragment>
              ) : null,
              m.rewatchCount ? `${m.rewatchCount} rewatch${m.rewatchCount > 1 ? "es" : ""}` : null,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " · "}
                  {part}
                </React.Fragment>
              ))}
          </div>
          {m.meta?.genres?.length ? (
            <div className="genres">
              {m.meta.genres.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
          ) : null}
          <CommunityRatings omdb={m.omdb} />
          {m.meta?.overview && <p className="overview">{m.meta.overview}</p>}
          <div className="actions">
            <button
              className={`btn ${m.isWatched ? "" : "primary"}`}
              onClick={() =>
                patch(m.uuid, (x) => {
                  x.isWatched = !x.isWatched;
                  x.watchedAt = x.isWatched ? new Date().toISOString() : null;
                  if (!x.isWatched) x.rewatchCount = 0;
                })
              }
            >
              {m.isWatched ? "✓ Watched" : "Mark watched"}
            </button>
            {m.isWatched && (
              <button
                className="btn"
                title="Log a rewatch"
                onClick={() =>
                  patch(m.uuid, (x) => {
                    x.rewatchCount = (x.rewatchCount || 0) + 1;
                    x.watchedAt = new Date().toISOString();
                  })
                }
              >
                ↻ Rewatch
              </button>
            )}
            <button
              className="btn"
              onClick={() => patch(m.uuid, (x) => (x.isFavorite = !x.isFavorite))}
            >
              {m.isFavorite ? "❤️ Favorite" : "🤍 Favorite"}
            </button>
            <Stars
              value={m.rating || 0}
              onChange={(v) => patch(m.uuid, (x) => (x.rating = v))}
            />
          </div>
          <div className="actions">
            <button
              className="btn small danger"
              onClick={() => {
                if (confirm(`Remove “${m.title}” from your library?`)) {
                  onRemove(m.uuid);
                  onClose();
                }
              }}
            >
              Remove from library
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
