import React, { useEffect, useRef, useState } from "react";
import { Modal, Stars, VaultMark } from "../ui.jsx";
import { img, recommendations, movieDetails, tvDetails } from "../tmdb.js";
import {
  addMovieFromTmdb,
  addShowFromTmdb,
  markItemWatched,
  inLibrary,
} from "../libops.js";

// Discover is the home feed: it loads itself, persists in the library file
// (instant on app start) and refreshes in the background when stale.
const STALE_MS = 6 * 60 * 60 * 1000;
const SEEDS_PER_KIND = 5;

function recencyBonus(iso) {
  if (!iso) return 0;
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days <= 90) return 100; // what you've been watching lately dominates
  if (days <= 365) return 40;
  return 0;
}

function movieSeedPool(lib) {
  const candidates = lib.movies.filter((m) => m.meta?.tmdbId && m.isWatched);
  const score = (m) =>
    recencyBonus(m.watchedAt) + (m.isFavorite ? 60 : 0) + (m.rating || 0) * 8;
  return [...candidates].sort(
    (a, b) =>
      score(b) - score(a) || (b.watchedAt || "").localeCompare(a.watchedAt || "")
  );
}

function showSeedPool(lib) {
  const lastWatched = (s) => {
    let last = null;
    for (const se of s.seasons)
      for (const e of se.episodes)
        if (e.isWatched && !e.bulk && e.watchedAt && (!last || e.watchedAt > last))
          last = e.watchedAt;
    return last;
  };
  const epCount = (s) =>
    s.seasons.reduce((t, se) => t + se.episodes.filter((e) => e.isWatched).length, 0);
  const candidates = lib.shows.filter((s) => s.meta?.tmdbId && epCount(s) > 0);
  const score = (s) =>
    recencyBonus(lastWatched(s)) + (s.isFavorite ? 60 : 0) + (s.rating || 0) * 8;
  return [...candidates].sort((a, b) => score(b) - score(a) || epCount(b) - epCount(a));
}

function dismissedInfo(lib) {
  const list = lib.notInterested || [];
  const ids = new Set(list.map((d) => `${d.kind}-${d.tmdbId}`));
  const genreCount = new Map();
  for (const d of list)
    for (const g of d.genreIds || []) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  return { ids, genreCount };
}

function toRec(r, kind, seedTitle) {
  return {
    id: r.id,
    kind,
    title: kind === "movie" ? r.title : r.name,
    year: (kind === "movie" ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
    poster: r.poster_path,
    backdrop: r.backdrop_path,
    overview: r.overview,
    vote: r.vote_average,
    genreIds: r.genre_ids || [],
    because: seedTitle,
  };
}

// Builds the whole feed: Top picks + one shelf per seed, no duplicates.
export async function buildDiscover(lib, key, round) {
  const dismissed = dismissedInfo(lib);
  const page = 1 + (round % 2);
  const seeds = [
    ...showSeedPool(lib).slice(0, SEEDS_PER_KIND).map((s) => ({ kind: "tv", item: s })),
    ...movieSeedPool(lib).slice(0, SEEDS_PER_KIND).map((m) => ({ kind: "movie", item: m })),
  ];

  const perSeed = []; // {seedTitle, kind, items}
  const byId = new Map(); // aggregate for top picks
  for (const seed of seeds) {
    let recs = [];
    try {
      recs = await recommendations(key, seed.kind, seed.item.meta.tmdbId, page);
    } catch {
      continue;
    }
    const items = [];
    for (const r of recs.slice(0, 14)) {
      if (inLibrary(lib, seed.kind, r.id)) continue;
      if (dismissed.ids.has(`${seed.kind === "tv" ? "show" : "movie"}-${r.id}`)) continue;
      if (dismissed.ids.has(`${seed.kind}-${r.id}`)) continue;
      const rec = toRec(r, seed.kind === "tv" ? "show" : "movie", seed.item.title);
      items.push(rec);
      const k = `${rec.kind}-${rec.id}`;
      const cur = byId.get(k);
      if (cur) cur.hits++;
      else byId.set(k, { ...rec, hits: 1 });
    }
    if (items.length) perSeed.push({ seed: seed.item.title, items });
  }

  const genrePenalty = (rec) =>
    (rec.genreIds || []).reduce(
      (p, g) => p + Math.min(dismissed.genreCount.get(g) || 0, 3),
      0
    );
  const claimed = new Set();
  const topPicks = [...byId.values()]
    .sort(
      (a, b) =>
        b.hits * 10 + (b.vote || 0) - genrePenalty(b) -
        (a.hits * 10 + (a.vote || 0) - genrePenalty(a))
    )
    .slice(0, 12);
  for (const t of topPicks) claimed.add(`${t.kind}-${t.id}`);

  const rows = [];
  for (const ps of perSeed) {
    const items = ps.items.filter((x) => !claimed.has(`${x.kind}-${x.id}`)).slice(0, 10);
    if (items.length >= 4) {
      for (const x of items) claimed.add(`${x.kind}-${x.id}`);
      rows.push({ seed: ps.seed, items });
    }
  }

  return { generatedAt: new Date().toISOString(), round, topPicks, rows };
}

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function DiscoverView({ lib, update, notify }) {
  const key = lib.settings?.tmdbKey;
  const data = lib.discover;
  const [loading, setLoading] = useState(false);
  const [openRec, setOpenRec] = useState(null);
  const [adding, setAdding] = useState(null);
  const running = useRef(false);

  const stale = !data || Date.now() - new Date(data.generatedAt).getTime() > STALE_MS;

  // The feed keeps itself fresh — no button required.
  useEffect(() => {
    if (key && stale && !running.current) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stale]);

  async function refresh() {
    running.current = true;
    setLoading(true);
    try {
      const round = (data?.round ?? -1) + 1;
      const feed = await buildDiscover(lib, key, round);
      update((next) => {
        next.discover = feed;
      });
    } catch (e) {
      notify(`Discover refresh failed: ${String(e).slice(0, 120)}`);
    } finally {
      running.current = false;
      setLoading(false);
    }
  }

  function dropEverywhere(next, rec) {
    if (!next.discover) return;
    const not = (x) => !(x.kind === rec.kind && x.id === rec.id);
    next.discover.topPicks = next.discover.topPicks.filter(not);
    for (const row of next.discover.rows) row.items = row.items.filter(not);
    next.discover.rows = next.discover.rows.filter((row) => row.items.length > 0);
  }

  function dismiss(rec) {
    update((next) => {
      if (!next.notInterested) next.notInterested = [];
      next.notInterested.push({
        kind: rec.kind,
        tmdbId: rec.id,
        title: rec.title,
        genreIds: rec.genreIds || [],
        at: new Date().toISOString(),
      });
      dropEverywhere(next, rec);
    });
    setOpenRec(null);
    notify(`Got it — “${rec.title}” won't be suggested again`);
  }

  async function add(rec, watched) {
    setAdding(`${rec.kind}-${rec.id}`);
    try {
      const { uuid, title } =
        rec.kind === "movie"
          ? await addMovieFromTmdb(update, key, rec.id)
          : await addShowFromTmdb(update, key, rec.id);
      if (watched) {
        markItemWatched(update, rec.kind, uuid, {
          dateIso: new Date().toISOString(),
          rating: watched.rating || null,
        });
      }
      update((next) => dropEverywhere(next, rec));
      notify(
        watched
          ? `“${title}” logged as watched${watched.rating ? ` · ★ ${watched.rating}` : ""}`
          : `Added “${title}” to your watchlist`
      );
      setOpenRec(null);
    } catch (e) {
      notify(`Could not add: ${String(e).slice(0, 120)}`);
    } finally {
      setAdding(null);
    }
  }

  if (!key) {
    return (
      <div className="welcome" style={{ height: "auto", padding: "60px 24px" }}>
        <VaultMark size={76} />
        <h1>Discover</h1>
        <p>
          Your personal home feed — recommendations from what you've been
          watching lately, refreshed automatically. Add your free TMDB API key
          in Settings to turn it on.
        </p>
      </div>
    );
  }

  if (!data && loading) {
    return (
      <div>
        <div className="feed-meta">Building your feed…</div>
        {[0, 1, 2].map((i) => (
          <div className="shelf" key={i}>
            <div className="skeleton-line" />
            <div className="shelf-row">
              {Array.from({ length: 6 }, (_, j) => (
                <div className="shelf-card skeleton-card" key={j} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!data) return <div className="empty">Preparing your feed…</div>;

  return (
    <div>
      <div className="feed-meta">
        {loading ? "Refreshing…" : `Updated ${timeAgo(data.generatedAt)}`}
        <button className="chip" onClick={refresh} disabled={loading}>
          ⟳ New batch
        </button>
        <span className="hint" style={{ margin: 0 }}>
          ✕ hides a title forever and teaches your taste
        </span>
      </div>

      {data.topPicks.length > 0 && (
        <Shelf
          title="Top picks for you"
          items={data.topPicks}
          adding={adding}
          onOpen={setOpenRec}
          onAdd={(r) => add(r, null)}
          onDismiss={dismiss}
        />
      )}
      {data.rows.map((row) => (
        <Shelf
          key={row.seed}
          title={`Because you watched ${row.seed}`}
          items={row.items}
          adding={adding}
          onOpen={setOpenRec}
          onAdd={(r) => add(r, null)}
          onDismiss={dismiss}
        />
      ))}
      {data.topPicks.length === 0 && data.rows.length === 0 && (
        <div className="empty">
          Nothing new right now — hit ⟳ New batch, or watch and rate a few more
          titles to sharpen the feed.
        </div>
      )}

      {openRec && (
        <RecDetail
          rec={openRec}
          tmdbKey={key}
          adding={adding}
          onAdd={add}
          onDismiss={dismiss}
          onClose={() => setOpenRec(null)}
        />
      )}
    </div>
  );
}

function Shelf({ title, items, adding, onOpen, onAdd, onDismiss }) {
  return (
    <div className="shelf">
      <h3>{title}</h3>
      <div className="shelf-row">
        {items.map((r) => (
          <div className="card shelf-card" key={`${r.kind}-${r.id}`} onClick={() => onOpen(r)}>
            <div className="poster">
              {r.poster ? (
                <img src={img(r.poster, "w342")} alt={r.title} loading="lazy" />
              ) : (
                <div className="fallback">
                  <span>{r.title}</span>
                </div>
              )}
              {r.vote ? <span className="badge fav">★ {r.vote.toFixed(1)}</span> : null}
              <button
                className="rec-dismiss visible"
                title="Not interested — never suggest again"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss(r);
                }}
              >
                ✕
              </button>
            </div>
            <div className="info">
              <div className="title">{r.title}</div>
              <div className="sub">
                <span>{r.year || "—"}</span>
                <span>{r.kind === "movie" ? "Movie" : "Show"}</span>
              </div>
              <button
                className="btn small primary"
                style={{ width: "100%", marginTop: 7, justifyContent: "center" }}
                disabled={adding === `${r.kind}-${r.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(r);
                }}
              >
                {adding === `${r.kind}-${r.id}` ? "Adding…" : "＋ Watchlist"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Detail sheet: overview + watchlist / watched-with-stars / not interested.
function RecDetail({ rec, tmdbKey, adding, onAdd, onDismiss, onClose }) {
  const [det, setDet] = useState(null);
  const [rating, setRating] = useState(0);

  useEffect(() => {
    let live = true;
    (rec.kind === "movie" ? movieDetails(tmdbKey, rec.id) : tvDetails(tmdbKey, rec.id))
      .then((d) => live && setDet(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [rec.id, rec.kind, tmdbKey]);

  const backdrop = rec.backdrop ? img(rec.backdrop, "w780") : null;
  const facts = [
    rec.year,
    rec.kind === "movie"
      ? det?.runtime
        ? `${det.runtime} min`
        : null
      : det
        ? `${det.number_of_seasons} season${det.number_of_seasons === 1 ? "" : "s"} · ${det.number_of_episodes} episodes`
        : null,
    rec.kind === "show" ? det?.status : null,
    rec.vote ? `★ ${rec.vote.toFixed(1)} on TMDB` : null,
  ].filter(Boolean);
  const busy = adding === `${rec.kind}-${rec.id}`;

  return (
    <Modal onClose={onClose}>
      <div
        className="backdrop"
        style={backdrop ? { backgroundImage: `url(${backdrop})` } : { height: 90 }}
      />
      <div className="body">
        <div className="poster-col">
          <div className="poster" style={{ borderRadius: 10, overflow: "hidden" }}>
            {rec.poster ? (
              <img src={img(rec.poster, "w342")} alt={rec.title} />
            ) : (
              <div className="fallback">
                <span>{rec.title}</span>
              </div>
            )}
          </div>
        </div>
        <div className="meta-col">
          <h2>{rec.title}</h2>
          <div className="subline">{facts.join(" · ")}</div>
          {det?.genres?.length ? (
            <div className="genres">
              {det.genres.map((g) => (
                <span key={g.id}>{g.name}</span>
              ))}
            </div>
          ) : null}
          <p className="overview">{rec.overview || det?.overview || "No description available."}</p>
          <p className="hint">Suggested because you watched {rec.because}.</p>
          <div className="actions" style={{ alignItems: "center" }}>
            <Stars value={rating} onChange={(v) => setRating(v || 0)} />
            <span className="hint" style={{ margin: 0 }}>
              rate it if you've already seen it
            </span>
          </div>
          <div className="actions" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={busy} onClick={() => onAdd(rec, null)}>
              ＋ Add to watchlist
            </button>
            <button className="btn" disabled={busy} onClick={() => onAdd(rec, { rating })}>
              ✓ Seen it{rating ? ` · ★ ${rating}` : ""}
            </button>
            <button className="btn" disabled={busy} onClick={() => onDismiss(rec)}>
              ✕ Not interested
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
