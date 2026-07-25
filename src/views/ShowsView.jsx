import React, { useEffect, useMemo, useState } from "react";
import {
  Poster,
  Modal,
  Stars,
  Progress,
  showProgress,
  showState,
  showBadge,
  fmtDate,
  CommunityRatings,
  isCanonSeason,
  isAiredEpisode,
} from "../ui.jsx";
import { img, tvDetails, fetchAllSeasons, tvMeta, findByExternalId } from "../tmdb.js";

const SORTS = [
  { id: "title", label: "Title A–Z" },
  { id: "progress", label: "Progress" },
  { id: "added_desc", label: "Recently added" },
  { id: "lastwatched", label: "Recently watched" },
];

function lastWatchedAt(show) {
  let last = "";
  for (const se of show.seasons)
    for (const e of se.episodes)
      if (e.isWatched && e.watchedAt && e.watchedAt > last) last = e.watchedAt;
  return last;
}

function filterBucket(show) {
  if (show.status === "stopped") return "stopped";
  const st = showState(show);
  if (st === "completed" || st === "uptodate") return "uptodate";
  if (st === "notstarted" || st === "notstarted-ended") return "towatch";
  return "watching"; // watching | newepisodes
}

// Merge a fresh TMDB season/episode list into an existing show (never un-watches).
export function mergeFreshSeasons(x, det, fresh) {
  x.meta = tvMeta(det);
  const byNum = new Map(x.seasons.map((se) => [se.number, se]));
  for (const freshSeason of fresh) {
    const cur = byNum.get(freshSeason.number);
    if (!cur) {
      x.seasons.push(freshSeason);
    } else {
      const epByNum = new Map(cur.episodes.map((e) => [e.number, e]));
      for (const fe of freshSeason.episodes) {
        const ce = epByNum.get(fe.number);
        if (!ce) cur.episodes.push(fe);
        else {
          ce.name = fe.name || ce.name;
          ce.airDate = fe.airDate || ce.airDate;
          ce.tmdb = fe.tmdb;
        }
      }
      cur.episodes.sort((a, b) => a.number - b.number);
    }
  }
  x.seasons.sort((a, b) => a.number - b.number);
}

export default function ShowsView({
  lib,
  query,
  update,
  notify,
  pendingOpen,
  onPendingConsumed,
}) {
  // Filter & sort choices are remembered in the library file.
  const prefs = lib.settings?.viewPrefs?.shows || {};
  const [filter, setFilterState] = useState(prefs.filter || "all");
  const [sort, setSortState] = useState(prefs.sort || "title");
  const [openUuid, setOpenUuid] = useState(null);

  // A home-feed card asked us to open a specific show's episode list.
  useEffect(() => {
    if (pendingOpen) {
      setOpenUuid(pendingOpen);
      onPendingConsumed?.();
    }
  }, [pendingOpen, onPendingConsumed]);

  const remember = (patch) =>
    update((next) => {
      if (!next.settings.viewPrefs) next.settings.viewPrefs = {};
      next.settings.viewPrefs.shows = {
        ...next.settings.viewPrefs.shows,
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
  const [checking, setChecking] = useState(null); // null | {done, total}

  const counts = useMemo(() => {
    const c = { all: lib.shows.length, watching: 0, uptodate: 0, towatch: 0, stopped: 0, favorites: 0 };
    for (const s of lib.shows) {
      c[filterBucket(s)]++;
      if (s.isFavorite) c.favorites++;
    }
    return c;
  }, [lib.shows]);

  const FILTERS = [
    { id: "all", label: `All ${counts.all}` },
    { id: "watching", label: `Watching ${counts.watching}` },
    { id: "uptodate", label: `Up to date ${counts.uptodate}` },
    { id: "towatch", label: `To watch ${counts.towatch}` },
    { id: "stopped", label: `Stopped ${counts.stopped}` },
    { id: "favorites", label: `Favorites ${counts.favorites}` },
  ];

  const shows = useMemo(() => {
    let list = lib.shows;
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((s) => s.title.toLowerCase().includes(q));
    }
    if (filter === "favorites") list = list.filter((s) => s.isFavorite);
    else if (filter !== "all") list = list.filter((s) => filterBucket(s) === filter);
    const by = {
      title: (a, b) => a.title.localeCompare(b.title),
      progress: (a, b) => {
        const pa = showProgress(a);
        const pb = showProgress(b);
        return (pb.total ? pb.watched / pb.total : 0) - (pa.total ? pa.watched / pa.total : 0);
      },
      added_desc: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
      lastwatched: (a, b) => lastWatchedAt(b).localeCompare(lastWatchedAt(a)),
    }[sort];
    return [...list].sort(by);
  }, [lib.shows, query, filter, sort]);

  const open = openUuid ? lib.shows.find((s) => s.uuid === openUuid) : null;
  const key = lib.settings?.tmdbKey;

  function patch(uuid, fn) {
    update((next) => {
      const s = next.shows.find((x) => x.uuid === uuid);
      if (s) fn(s);
    });
  }

  function remove(uuid) {
    update((next) => {
      next.shows = next.shows.filter((x) => x.uuid !== uuid);
    });
  }

  // Refresh episode lists for every running (non-ended) show with known TMDB id.
  async function checkForNewEpisodes() {
    if (!key) {
      notify("Add a TMDB API key in Settings first.");
      return;
    }
    const targets = lib.shows.filter(
      (s) => s.meta?.tmdbId && !/ended|canceled/i.test(s.meta?.statusText || "")
    );
    if (!targets.length) {
      notify("No running shows with TMDB metadata to check.");
      return;
    }
    setChecking({ done: 0, total: targets.length });
    let newEps = 0;
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      try {
        const det = await tvDetails(key, s.meta.tmdbId);
        const fresh = await fetchAllSeasons(key, s.meta.tmdbId, det.seasons);
        const before = s.seasons.reduce((n, se) => n + se.episodes.length, 0);
        patch(s.uuid, (x) => mergeFreshSeasons(x, det, fresh));
        const after = fresh.reduce((n, se) => n + se.episodes.length, 0);
        if (after > before) newEps += after - before;
      } catch {
        // skip failures, keep going
      }
      setChecking({ done: i + 1, total: targets.length });
    }
    setChecking(null);
    notify(newEps > 0 ? `Found ${newEps} new episodes` : "All running shows are up to date");
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
          <button
            className="chip"
            disabled={!!checking}
            onClick={checkForNewEpisodes}
            title="Refresh episode lists of running shows from TMDB"
          >
            {checking ? `Checking ${checking.done}/${checking.total}…` : "⟳ Check for new episodes"}
          </button>
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>

      {shows.length === 0 ? (
        <div className="empty">No shows match this filter.</div>
      ) : (
        <div className="grid">
          {shows.map((s) => {
            const { watched, total } = showProgress(s);
            return (
              <div className="card" key={s.uuid} onClick={() => setOpenUuid(s.uuid)}>
                <Poster item={s} badge={showBadge(s)} />
                <div className="info">
                  <div className="title">{s.title}</div>
                  <div className="sub">
                    <span>
                      {watched}/{total} eps
                    </span>
                    {s.rating ? <span>★ {s.rating}</span> : null}
                  </div>
                  <Progress value={watched} max={total} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <ShowDetail
          show={open}
          lib={lib}
          patch={patch}
          onRemove={remove}
          notify={notify}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </>
  );
}

function ShowDetail({ show, lib, patch, onRemove, notify, onClose }) {
  const s = show;
  const [openSeason, setOpenSeason] = useState(() => {
    const next = s.seasons.find(
      (se) => !se.isSpecials && se.episodes.some((e) => !e.isWatched)
    );
    return next ? next.number : null;
  });
  const [syncing, setSyncing] = useState(false);
  const backdrop = s.meta?.backdrop ? img(s.meta.backdrop, "w780") : null;
  const { watched, total } = showProgress(s);
  const key = lib.settings?.tmdbKey;
  const ended = /ended|canceled/i.test(s.meta?.statusText || "");

  async function syncEpisodes() {
    if (!key) {
      notify("Add a TMDB API key in Settings first.");
      return;
    }
    setSyncing(true);
    try {
      let tmdbId = s.meta?.tmdbId;
      if (!tmdbId) {
        const found = await findByExternalId(key, {
          imdb: s.imdb,
          tvdb: s.tvdb,
          kind: "tv",
        });
        if (!found) throw new Error("Show not found on TMDB");
        tmdbId = found.id;
      }
      const det = await tvDetails(key, tmdbId);
      const fresh = await fetchAllSeasons(key, tmdbId, det.seasons);
      patch(s.uuid, (x) => mergeFreshSeasons(x, det, fresh));
      notify("Episode list synced with TMDB");
    } catch (e) {
      notify(`Sync failed: ${String(e).slice(0, 120)}`);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div
        className="backdrop"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : { height: 90 }}
      />
      <div className="body">
        <div className="poster-col">
          <Poster item={s} badge={showBadge(s)} />
        </div>
        <div className="meta-col">
          <h2>{s.title}</h2>
          <div className="subline">
            {[
              s.meta?.firstAirDate ? s.meta.firstAirDate.slice(0, 4) : null,
              s.meta?.statusText || null,
              `${watched}/${total} episodes watched`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {s.meta?.genres?.length ? (
            <div className="genres">
              {s.meta.genres.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
          ) : null}
          <CommunityRatings omdb={s.omdb} />
          {s.meta?.overview && <p className="overview">{s.meta.overview}</p>}
          <div className="actions">
            <button
              className="btn"
              onClick={() => patch(s.uuid, (x) => (x.isFavorite = !x.isFavorite))}
            >
              {s.isFavorite ? "❤️ Favorite" : "🤍 Favorite"}
            </button>
            <button className="btn" disabled={syncing} onClick={syncEpisodes}>
              {syncing ? "Syncing…" : "⟳ Sync episodes"}
            </button>
            <button
              className="btn"
              title="Mark as stopped watching"
              onClick={() =>
                patch(s.uuid, (x) => {
                  x.status = x.status === "stopped" ? null : "stopped";
                })
              }
            >
              {s.status === "stopped" ? "▶ Resume" : "⏸ Stop tracking"}
            </button>
            <Stars
              value={s.rating || 0}
              onChange={(v) => patch(s.uuid, (x) => (x.rating = v))}
            />
          </div>
          <div className="actions">
            <button
              className="btn small"
              title="Hidden shows don't appear in Stats charts"
              onClick={() => patch(s.uuid, (x) => (x.hideFromStats = !x.hideFromStats))}
            >
              {s.hideFromStats ? "📊 Show in stats" : "📊 Hide from stats"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 24px 24px" }}>
        <div className="seasons">
          {[...s.seasons]
            .filter((se) => se.episodes.length > 0)
            .sort(
              (a, b) =>
                (isCanonSeason(a) ? 0 : 1) - (isCanonSeason(b) ? 0 : 1) ||
                a.number - b.number
            )
            .map((se) => {
              const specials = !isCanonSeason(se);
              const wc = se.episodes.filter((e) => e.isWatched).length;
              const isOpen = openSeason === se.number;
              return (
                <div className={`season ${specials ? "specials" : ""}`} key={se.number}>
                  <button
                    className="season-head"
                    onClick={() => setOpenSeason(isOpen ? null : se.number)}
                  >
                    <span>{specials ? "Specials" : `Season ${se.number}`}</span>
                    <span className="frac">
                      {specials ? "extras · not tracked" : `${wc}/${se.episodes.length}`}
                    </span>
                    {!specials && (
                      <span className="mini-progress" style={{ flex: 1, maxWidth: 140 }}>
                        <Progress value={wc} max={se.episodes.length} />
                      </span>
                    )}
                    <span
                      className="mark-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        const allWatched = wc === se.episodes.length;
                        const marking = se.episodes.length - wc;
                        patch(s.uuid, (x) => {
                          const target = x.seasons.find((q) => q.number === se.number);
                          const now = new Date().toISOString();
                          for (const ep of target.episodes) {
                            if (!allWatched && !ep.isWatched && marking > 3) {
                              // Marking a whole stretch at once is logging
                              // history, not watching — keep time charts clean.
                              ep.bulk = true;
                            }
                            if (allWatched) delete ep.bulk;
                            ep.isWatched = !allWatched;
                            ep.watchedAt = !allWatched ? ep.watchedAt || now : null;
                          }
                        });
                      }}
                    >
                      {wc === se.episodes.length ? "Unmark all" : "Mark all"}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="episodes">
                      {se.episodes.map((ep) => {
                        const future = !isAiredEpisode(ep);
                        return (
                          <div
                            key={ep.number}
                            className={`episode ${ep.isWatched ? "watched" : ""}`}
                          >
                            <button
                              className={`check ${ep.isWatched ? "on" : ""}`}
                              title={ep.isWatched ? "Mark unwatched" : "Mark watched"}
                              onClick={() =>
                                patch(s.uuid, (x) => {
                                  const target = x.seasons.find(
                                    (q) => q.number === se.number
                                  );
                                  const e2 = target.episodes.find(
                                    (q) => q.number === ep.number
                                  );
                                  e2.isWatched = !e2.isWatched;
                                  e2.watchedAt = e2.isWatched
                                    ? new Date().toISOString()
                                    : null;
                                  delete e2.bulk; // individual toggle = real event
                                })
                              }
                            >
                              ✓
                            </button>
                            <span className="num">
                              {se.isSpecials ? "SP" : `E${String(ep.number).padStart(2, "0")}`}
                            </span>
                            <span className="name">{ep.name || `Episode ${ep.number}`}</span>
                            {future && (
                              <span className="date">
                                {ep.airDate ? `airs ${fmtDate(ep.airDate)}` : "not aired yet"}
                              </span>
                            )}
                            {ep.isWatched && ep.watchedAt && (
                              <span className="date">{fmtDate(ep.watchedAt)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
        <div className="actions" style={{ marginTop: 14 }}>
          <button
            className="btn small danger"
            onClick={() => {
              if (confirm(`Remove “${s.title}” and its watch history from your library?`)) {
                onRemove(s.uuid);
                onClose();
              }
            }}
          >
            Remove from library
          </button>
        </div>
      </div>
    </Modal>
  );
}
