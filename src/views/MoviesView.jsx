import React, { useEffect, useMemo, useState } from "react";
import { Poster, movieBadge, CommunityRatings, WatchDate } from "../ui.jsx";
import { DetailCard, favoriteAction } from "../DetailCard.jsx";
import { img } from "../tmdb.js";
import CatalogResults from "./CatalogResults.jsx";

const SORTS = [
  { id: "watched_desc", label: "Recently watched", needsWatched: true },
  { id: "rating_desc", label: "My rating", needsWatched: true },
  { id: "community_desc", label: "Community rating" },
  { id: "added_desc", label: "Recently added" },
  { id: "title", label: "Title A–Z" },
  { id: "year_desc", label: "Year (newest)" },
  { id: "year_asc", label: "Year (oldest)" },
];

export default function MoviesView({
  lib,
  query,
  update,
  notify,
  pendingOpen,
  onPendingConsumed,
}) {
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

  // A query searches the whole shelf. Leaving the status filter on would hide
  // the very film you are looking for behind a chip you set last week — and
  // then offer it back as "not in your library", which it is.
  const searching = query.trim().length > 0;

  const movies = useMemo(() => {
    let list = lib.movies;
    if (searching) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.title.toLowerCase().includes(q));
    } else {
      if (filter === "watched") list = list.filter((m) => m.isWatched);
      if (filter === "towatch") list = list.filter((m) => !m.isWatched);
      if (filter === "favorites") list = list.filter((m) => m.isFavorite);
    }
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
  }, [lib.movies, query, searching, filter, effectiveSort]);

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

      {searching && (
        <p className="search-scope">
          Searching all {lib.movies.length} films — filters paused.
        </p>
      )}

      {movies.length === 0 ? (
        query ? (
          <p className="empty-filter">Nothing in your movies matches “{query}”.</p>
        ) : (
          <div className="empty">No movies match this filter.</div>
        )
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

      {/* The same box that filters the shelf searches TMDB behind it. */}
      <CatalogResults
        kind="movie"
        query={query}
        lib={lib}
        update={update}
        notify={notify}
      />

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
  const set = (fn) => patch(m.uuid, fn);

  return (
    <DetailCard
      onClose={onClose}
      title={m.title}
      art={<Poster item={m} badge={movieBadge(m)} />}
      backdropUrl={m.meta?.backdrop ? img(m.meta.backdrop, "w780") : null}
      facts={[
        m.year,
        m.meta?.runtime ? `${m.meta.runtime} min` : null,
        m.isWatched && m.watchedAt ? (
          <React.Fragment key="watched">
            Watched <WatchDate iso={m.watchedAt} onChange={(iso) => set((x) => (x.watchedAt = iso))} />
          </React.Fragment>
        ) : null,
        m.rewatchCount ? `${m.rewatchCount} rewatch${m.rewatchCount > 1 ? "es" : ""}` : null,
      ]}
      tags={m.meta?.genres || []}
      extra={<CommunityRatings omdb={m.omdb} />}
      overview={m.meta?.overview}
      actions={[
        {
          id: "watched",
          label: m.isWatched ? "✓ Watched" : "Mark watched",
          variant: m.isWatched ? null : "primary",
          active: m.isWatched,
          onClick: () =>
            set((x) => {
              x.isWatched = !x.isWatched;
              x.watchedAt = x.isWatched ? new Date().toISOString() : null;
              if (!x.isWatched) x.rewatchCount = 0;
            }),
        },
        m.isWatched && {
          id: "rewatch",
          label: "↻ Rewatch",
          title: "Log a rewatch",
          onClick: () =>
            set((x) => {
              x.rewatchCount = (x.rewatchCount || 0) + 1;
              x.watchedAt = new Date().toISOString();
            }),
        },
        favoriteAction(m.isFavorite, () => set((x) => (x.isFavorite = !x.isFavorite))),
      ]}
      rating={{ value: m.rating || 0, onChange: (v) => set((x) => (x.rating = v)) }}
      minorActions={[
        {
          id: "remove",
          label: "Remove from library",
          variant: "danger",
          onClick: () => {
            if (confirm(`Remove “${m.title}” from your library?`)) {
              onRemove(m.uuid);
              onClose();
            }
          },
        },
      ]}
    />
  );
}
