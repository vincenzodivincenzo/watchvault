import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Poster,
  Modal,
  Stars,
  fmtDate,
  CommunityRatings,
  isCanonEpisode,
  isAiredEpisode,
} from "../ui.jsx";
import { watchProviders } from "../tmdb.js";

function isShowToWatch(s) {
  if (s.status === "stopped") return false;
  // Only canonical episodes count as "started" — watching a special doesn't
  // pull a show off the watchlist.
  return !s.seasons.some((se) =>
    se.episodes.some((e) => isCanonEpisode(se, e) && e.isWatched)
  );
}

export default function WatchlistView({ lib, query, update, notify }) {
  const [log, setLog] = useState(null); // {kind: "movie"|"show", uuid}
  const providersRun = useRef(false);
  const tmdbKey = lib.settings?.tmdbKey;
  const country = lib.settings?.country || "IT";

  // Fetch streaming availability for watchlist items that don't have it yet
  // (or that were fetched for a different country).
  useEffect(() => {
    if (!tmdbKey || providersRun.current) return;
    const targets = [
      ...lib.movies
        .filter((m) => !m.isWatched && m.meta?.tmdbId && m.providers?.country !== country)
        .map((m) => ({ kind: "movie", uuid: m.uuid, tmdbId: m.meta.tmdbId, api: "movie" })),
      ...lib.shows
        .filter((s) => isShowToWatch(s) && s.meta?.tmdbId && s.providers?.country !== country)
        .map((s) => ({ kind: "show", uuid: s.uuid, tmdbId: s.meta.tmdbId, api: "tv" })),
    ];
    if (!targets.length) return;
    providersRun.current = true;
    let cancelled = false;
    (async () => {
      for (const t of targets) {
        if (cancelled) return;
        try {
          const p = await watchProviders(tmdbKey, t.api, t.tmdbId, country);
          update((next) => {
            const list = t.kind === "movie" ? next.movies : next.shows;
            const item = list.find((x) => x.uuid === t.uuid);
            if (item)
              item.providers = { country, ...p, fetchedAt: new Date().toISOString() };
          });
        } catch {
          // transient failure — try again next time the view opens
        }
        await new Promise((r) => setTimeout(r, 80));
      }
      providersRun.current = false;
    })();
    return () => {
      cancelled = true;
      providersRun.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbKey, country]);

  const q = query.toLowerCase();
  const movies = useMemo(
    () =>
      lib.movies
        .filter((m) => !m.isWatched && (!q || m.title.toLowerCase().includes(q)))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [lib.movies, q]
  );
  const shows = useMemo(
    () =>
      lib.shows
        .filter((s) => isShowToWatch(s) && (!q || s.title.toLowerCase().includes(q)))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    [lib.shows, q]
  );

  function removeFromList(kind, uuid, title) {
    if (!confirm(`Remove “${title}” from your library?`)) return;
    update((next) => {
      if (kind === "movie") next.movies = next.movies.filter((x) => x.uuid !== uuid);
      else next.shows = next.shows.filter((x) => x.uuid !== uuid);
    });
  }

  function confirmLog({ kind, uuid, date, rating }) {
    // Noon local time keeps the calendar day stable across timezones.
    const iso = new Date(`${date}T12:00:00`).toISOString();
    let title = "";
    let episodes = 0;
    update((next) => {
      if (kind === "movie") {
        const m = next.movies.find((x) => x.uuid === uuid);
        if (!m) return;
        title = m.title;
        m.isWatched = true;
        m.watchedAt = iso;
        if (rating) m.rating = rating;
      } else {
        const s = next.shows.find((x) => x.uuid === uuid);
        if (!s) return;
        title = s.title;
        if (rating) s.rating = rating;
        for (const se of s.seasons) {
          for (const e of se.episodes) {
            if (!isCanonEpisode(se, e)) continue;
            if (isAiredEpisode(e) && !e.isWatched) {
              e.isWatched = true;
              e.watchedAt = iso;
              // Logging a whole series at once is history, not one sitting.
              e.bulk = true;
              episodes++;
            }
          }
        }
      }
    });
    setLog(null);
    notify(
      kind === "movie"
        ? `“${title}” logged as watched${rating ? ` · ★ ${rating}` : ""}`
        : `“${title}” — ${episodes} episodes logged${rating ? ` · ★ ${rating}` : ""}`
    );
  }

  const openItem =
    log &&
    (log.kind === "movie"
      ? lib.movies.find((m) => m.uuid === log.uuid)
      : lib.shows.find((s) => s.uuid === log.uuid));

  return (
    <>
      <Section
        title={`Movies to watch · ${movies.length}`}
        items={movies}
        kind="movie"
        onLog={(uuid) => setLog({ kind: "movie", uuid })}
        onRemove={removeFromList}
      />
      <Section
        title={`Series to watch · ${shows.length}`}
        items={shows}
        kind="show"
        onLog={(uuid) => setLog({ kind: "show", uuid })}
        onRemove={removeFromList}
      />
      {movies.length === 0 && shows.length === 0 && (
        <div className="empty">
          Your watchlist is empty — add titles with the ＋ Add button or from Discover.
        </div>
      )}
      {openItem && (
        <LogWatchModal
          kind={log.kind}
          item={openItem}
          onConfirm={confirmLog}
          onClose={() => setLog(null)}
        />
      )}
    </>
  );
}

function Section({ title, items, kind, onLog, onRemove }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 26 }}>
      <h3 style={{ margin: "6px 0 14px", fontSize: 15 }}>{title}</h3>
      <div className="grid">
        {items.map((it) => (
          <div className="card" key={it.uuid} onClick={() => onLog(it.uuid)}>
            <Poster item={it} />
            <div className="info">
              <div className="title">{it.title}</div>
              <div className="sub">
                <span>
                  {kind === "movie"
                    ? it.year || "—"
                    : `${it.seasons.reduce(
                        (n, se) =>
                          n + se.episodes.filter((e) => isCanonEpisode(se, e)).length,
                        0
                      )} eps`}
                </span>
                {it.createdAt ? <span>added {fmtDate(it.createdAt)}</span> : null}
              </div>
              <Providers item={it} />
              <button
                className="btn small primary"
                style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onLog(it.uuid);
                }}
              >
                ✓ Watched
              </button>
              <button
                className="btn small"
                style={{ width: "100%", marginTop: 6, justifyContent: "center" }}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(kind, it.uuid, it.title);
                }}
              >
                ✕ Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Providers({ item }) {
  const p = item.providers;
  if (!p) return null;
  const names = [...(p.flatrate || []), ...(p.free || [])];
  return (
    <div className="providers" title={`Streaming in ${p.country}`}>
      {names.length
        ? `▶ ${[...new Set(names)].slice(0, 3).join(" · ")}`
        : `Not streaming in ${p.country}`}
    </div>
  );
}

function LogWatchModal({ kind, item, onConfirm, onClose }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [rating, setRating] = useState(item.rating || 0);
  const today = new Date().toISOString().slice(0, 10);
  const airedEps =
    kind === "show"
      ? item.seasons.reduce(
          (n, se) =>
            n +
            se.episodes.filter(
              (e) => isCanonEpisode(se, e) && isAiredEpisode(e) && !e.isWatched
            ).length,
          0
        )
      : 0;

  return (
    <Modal onClose={onClose} title={`Log ${item.title} as watched`}>
      <div className="body" style={{ marginTop: 0, paddingTop: 24 }}>
        <div className="poster-col">
          <Poster item={item} />
        </div>
        <div className="meta-col" style={{ paddingTop: 0 }}>
          <h2>{item.title}</h2>
          <div className="subline">
            {kind === "movie"
              ? "Log this movie as watched"
              : `Log the whole series as watched — ${airedEps} aired episodes`}
          </div>
          <CommunityRatings omdb={item.omdb} />
          <Providers item={item} />
          {item.meta?.overview && (
            <p className="overview" style={{ marginTop: 6 }}>
              {item.meta.overview.slice(0, 220)}
              {item.meta.overview.length > 220 ? "…" : ""}
            </p>
          )}
          <div className="actions" style={{ alignItems: "center", marginTop: 14 }}>
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
          <div className="actions" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              onClick={() =>
                onConfirm({ kind, uuid: item.uuid, date, rating: rating || null })
              }
            >
              ✓ Mark watched{rating ? ` · ★ ${rating}` : ""}
            </button>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
