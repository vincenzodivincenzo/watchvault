import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Stars, VaultMark, Progress, showState, isCanonEpisode } from "../ui.jsx";
import { img, recommendations, movieDetails, tvDetails } from "../tmdb.js";
import {
  addMovieFromTmdb,
  addShowFromTmdb,
  markItemWatched,
  inLibrary,
} from "../libops.js";

// Discover is the home page: your own library up top (keep watching, new
// episodes, long-paused shows), then recommendations that refresh themselves.
const STALE_MS = 6 * 60 * 60 * 1000;
const SEEDS_PER_KIND = 5;
const PAUSED_AFTER_DAYS = 60;

// TMDB genre ids are stable — good enough for card tags without extra calls.
const MOVIE_GENRES = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Sci-Fi", 53: "Thriller", 10752: "War", 37: "Western",
};
const TV_GENRES = {
  10759: "Action", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10764: "Reality", 10765: "Sci-Fi", 10766: "Soap",
  10768: "War & Politics", 37: "Western",
};

function genreTags(kindApi, ids) {
  const table = kindApi === "movie" ? MOVIE_GENRES : TV_GENRES;
  return (ids || []).map((id) => table[id]).filter(Boolean).slice(0, 2);
}

function recencyBonus(iso) {
  if (!iso) return 0;
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days <= 90) return 100;
  if (days <= 365) return 40;
  return 0;
}

function lastWatchedAt(s, { realOnly = false } = {}) {
  let last = null;
  for (const se of s.seasons)
    for (const e of se.episodes)
      if (
        e.isWatched &&
        e.watchedAt &&
        (!realOnly || !e.bulk) &&
        (!last || e.watchedAt > last)
      )
        last = e.watchedAt;
  return last;
}

function nextEpisode(s) {
  const today = new Date().toISOString().slice(0, 10);
  const seasons = [...s.seasons].sort((a, b) => a.number - b.number);
  for (const se of seasons)
    for (const e of [...se.episodes].sort((a, b) => a.number - b.number))
      if (
        isCanonEpisode(se, e) &&
        !e.isWatched &&
        (!e.airDate || e.airDate <= today)
      )
        return { season: se.number, episode: e.number, name: e.name };
  return null;
}

function epCode(next) {
  return `S${String(next.season).padStart(2, "0")}E${String(next.episode).padStart(2, "0")}`;
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
  const epCount = (s) =>
    s.seasons.reduce((t, se) => t + se.episodes.filter((e) => e.isWatched).length, 0);
  const candidates = lib.shows.filter((s) => s.meta?.tmdbId && epCount(s) > 0);
  const score = (s) =>
    recencyBonus(lastWatchedAt(s, { realOnly: true })) +
    (s.isFavorite ? 60 : 0) +
    (s.rating || 0) * 8;
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

// What you love, as genre names — used to boost matching recommendations.
function tasteGenres(lib) {
  const taste = new Map();
  const bump = (item, weight) => {
    if (!weight) return;
    for (const g of item.meta?.genres || [])
      taste.set(g, (taste.get(g) || 0) + weight);
  };
  for (const m of lib.movies)
    if (m.isWatched)
      bump(
        m,
        (m.isFavorite ? 2 : 0) +
          (m.rating >= 4 ? 2 : 0) +
          (recencyBonus(m.watchedAt) ? 1 : 0)
      );
  for (const s of lib.shows) {
    const watched = s.seasons.some((se) => se.episodes.some((e) => e.isWatched));
    if (watched)
      bump(
        s,
        (s.isFavorite ? 2 : 0) +
          (s.rating >= 4 ? 2 : 0) +
          (recencyBonus(lastWatchedAt(s, { realOnly: true })) ? 1 : 0)
      );
  }
  return taste;
}

// Junk filter: enough votes and a decent score, or it doesn't enter the feed.
function passesQuality(r, kindApi) {
  const votes = r.vote_count ?? 0;
  const score = r.vote_average ?? 0;
  return votes >= (kindApi === "movie" ? 200 : 50) && score >= 6;
}

function toRec(r, kindApi, seedTitle) {
  const kind = kindApi === "tv" ? "show" : "movie";
  return {
    id: r.id,
    kind,
    title: kindApi === "movie" ? r.title : r.name,
    year: (kindApi === "movie" ? r.release_date : r.first_air_date)?.slice(0, 4) || null,
    poster: r.poster_path,
    backdrop: r.backdrop_path,
    overview: r.overview,
    vote: r.vote_average,
    genreIds: r.genre_ids || [],
    tags: genreTags(kindApi, r.genre_ids),
    because: seedTitle,
  };
}

export async function buildDiscover(lib, key, round) {
  const dismissed = dismissedInfo(lib);
  const taste = tasteGenres(lib);
  const page = 1 + (round % 2);
  const seeds = [
    ...showSeedPool(lib).slice(0, SEEDS_PER_KIND).map((s) => ({ kindApi: "tv", item: s })),
    ...movieSeedPool(lib).slice(0, SEEDS_PER_KIND).map((m) => ({ kindApi: "movie", item: m })),
  ];

  const perSeed = [];
  const byId = new Map();
  for (const seed of seeds) {
    let recs = [];
    try {
      recs = await recommendations(key, seed.kindApi, seed.item.meta.tmdbId, page);
    } catch {
      continue;
    }
    const items = [];
    for (const r of recs) {
      if (!passesQuality(r, seed.kindApi)) continue;
      const kind = seed.kindApi === "tv" ? "show" : "movie";
      if (inLibrary(lib, seed.kindApi === "tv" ? "tv" : "movie", r.id)) continue;
      if (dismissed.ids.has(`${kind}-${r.id}`)) continue;
      const rec = toRec(r, seed.kindApi, seed.item.title);
      items.push(rec);
      const k = `${rec.kind}-${rec.id}`;
      const cur = byId.get(k);
      if (cur) cur.hits++;
      else byId.set(k, { ...rec, hits: 1 });
      if (items.length >= 14) break;
    }
    if (items.length)
      perSeed.push({
        seed: seed.item.title,
        kindApi: seed.kindApi,
        tmdbId: seed.item.meta.tmdbId,
        page,
        items,
      });
  }

  const genrePenalty = (rec) =>
    (rec.genreIds || []).reduce(
      (p, g) => p + Math.min(dismissed.genreCount.get(g) || 0, 3),
      0
    );
  const tasteBoost = (rec) =>
    (rec.tags || []).reduce((b, name) => b + Math.min(taste.get(name) || 0, 6) * 0.6, 0);
  const rank = (r) => r.hits * 10 + (r.vote || 0) + tasteBoost(r) - genrePenalty(r);

  const claimed = new Set();
  const topPicks = [...byId.values()].sort((a, b) => rank(b) - rank(a)).slice(0, 12);
  for (const t of topPicks) claimed.add(`${t.kind}-${t.id}`);

  const rows = [];
  for (const ps of perSeed) {
    const items = ps.items
      .filter((x) => !claimed.has(`${x.kind}-${x.id}`))
      .sort((a, b) => rank({ ...b, hits: 0 }) - rank({ ...a, hits: 0 }))
      .slice(0, 10);
    if (items.length >= 4) {
      for (const x of items) claimed.add(`${x.kind}-${x.id}`);
      rows.push({ seed: ps.seed, kindApi: ps.kindApi, tmdbId: ps.tmdbId, page: ps.page, items });
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

export default function DiscoverView({ lib, update, notify, onOpenShow }) {
  const key = lib.settings?.tmdbKey;
  const data = lib.discover;
  const [loading, setLoading] = useState(false);
  const [moreBusy, setMoreBusy] = useState(null);
  const [openRec, setOpenRec] = useState(null);
  const [adding, setAdding] = useState(null);
  const running = useRef(false);

  const stale = !data || Date.now() - new Date(data.generatedAt).getTime() > STALE_MS;

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

  // ＋ More on a "Because you watched" row: pull the seed's next page.
  async function loadMore(row) {
    setMoreBusy(row.seed);
    try {
      const nextPage = (row.page || 1) + 1;
      const recs = await recommendations(key, row.kindApi, row.tmdbId, nextPage);
      const dismissed = dismissedInfo(lib);
      const existing = new Set([
        ...(lib.discover?.topPicks || []).map((x) => `${x.kind}-${x.id}`),
        ...(lib.discover?.rows || []).flatMap((rw) => rw.items.map((x) => `${x.kind}-${x.id}`)),
      ]);
      const fresh = [];
      for (const r of recs) {
        if (!passesQuality(r, row.kindApi)) continue;
        const rec = toRec(r, row.kindApi, row.seed);
        const k = `${rec.kind}-${rec.id}`;
        if (existing.has(k) || dismissed.ids.has(k)) continue;
        if (inLibrary(lib, row.kindApi === "tv" ? "tv" : "movie", rec.id)) continue;
        fresh.push(rec);
        if (fresh.length >= 8) break;
      }
      if (!fresh.length) {
        notify(`No more good matches from ${row.seed} right now`);
        return;
      }
      update((next) => {
        const target = next.discover?.rows.find((rw) => rw.seed === row.seed);
        if (target) {
          target.items.push(...fresh);
          target.page = nextPage;
        }
      });
    } catch (e) {
      notify(`Could not load more: ${String(e).slice(0, 120)}`);
    } finally {
      setMoreBusy(null);
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

  // Library shelves — computed live, no network needed.
  const libraryShelves = useMemo(() => {
    const inProgress = [];
    for (const s of lib.shows) {
      if (s.status === "stopped") continue;
      const st = showState(s);
      if (st !== "watching" && st !== "newepisodes") continue;
      const next = nextEpisode(s);
      if (!next) continue;
      inProgress.push({ s, st, next, last: lastWatchedAt(s) });
    }
    inProgress.sort((a, b) => (b.last || "").localeCompare(a.last || ""));
    const cutoff = Date.now() - PAUSED_AFTER_DAYS * 86400000;
    const isPaused = (x) => !x.last || new Date(x.last).getTime() < cutoff;
    return {
      newEpisodes: inProgress.filter((x) => x.st === "newepisodes").slice(0, 12),
      keepWatching: inProgress
        .filter((x) => x.st === "watching" && !isPaused(x))
        .slice(0, 12),
      pickBackUp: inProgress
        .filter((x) => x.st === "watching" && isPaused(x))
        .slice(0, 12),
    };
  }, [lib.shows]);

  function markNext(uuid) {
    let logged = null;
    update((next) => {
      const s = next.shows.find((x) => x.uuid === uuid);
      if (!s) return;
      const nxt = nextEpisode(s);
      if (!nxt) return;
      const se = s.seasons.find((q) => q.number === nxt.season);
      const ep = se.episodes.find((q) => q.number === nxt.episode);
      ep.isWatched = true;
      ep.watchedAt = new Date().toISOString();
      delete ep.bulk;
      logged = `${s.title} ${epCode(nxt)}`;
    });
    if (logged) notify(`✓ ${logged} logged`);
  }

  const hour = new Date().getHours();
  const greeting =
    hour < 6 ? "Up late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  if (!key) {
    return (
      <div className="welcome" style={{ height: "auto", padding: "60px 24px" }}>
        <VaultMark size={76} />
        <h1>Home</h1>
        <p>
          Your personal home feed — what to continue, what's new, and what to
          watch next. Add your free TMDB API key in Settings to turn it on.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="greeting">{greeting}.</h2>
      <div className="feed-meta">
        {loading
          ? "Refreshing recommendations…"
          : data
            ? `Updated ${timeAgo(data.generatedAt)}`
            : "Building your feed…"}
        <button className="chip" onClick={refresh} disabled={loading}>
          ⟳ New batch
        </button>
        <span className="hint" style={{ margin: 0 }}>
          ✕ hides a title forever and teaches your taste
        </span>
      </div>

      {libraryShelves.keepWatching.length > 0 && (
        <LibShelf
          title="Keep watching"
          rows={libraryShelves.keepWatching}
          onOpenShow={onOpenShow}
          onMarkNext={markNext}
        />
      )}
      {libraryShelves.newEpisodes.length > 0 && (
        <LibShelf
          title="New episodes for you"
          rows={libraryShelves.newEpisodes}
          onOpenShow={onOpenShow}
          onMarkNext={markNext}
        />
      )}

      {!data && loading && (
        <div className="shelf">
          <div className="skeleton-line" />
          <div className="shelf-row">
            {Array.from({ length: 6 }, (_, j) => (
              <div className="shelf-card skeleton-card" key={j} />
            ))}
          </div>
        </div>
      )}

      {data?.topPicks.length > 0 && (
        <RecShelf
          title="Top picks for you"
          items={data.topPicks}
          adding={adding}
          onOpen={setOpenRec}
          onAdd={(r) => add(r, null)}
          onDismiss={dismiss}
        />
      )}
      {data?.rows.map((row) => (
        <RecShelf
          key={row.seed}
          title={`Because you watched ${row.seed}`}
          items={row.items}
          adding={adding}
          onOpen={setOpenRec}
          onAdd={(r) => add(r, null)}
          onDismiss={dismiss}
          onMore={row.tmdbId ? () => loadMore(row) : null}
          moreBusy={moreBusy === row.seed}
        />
      ))}

      {libraryShelves.pickBackUp.length > 0 && (
        <LibShelf
          title="Haven't seen in a while"
          rows={libraryShelves.pickBackUp}
          onOpenShow={onOpenShow}
          onMarkNext={markNext}
        />
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

// A shelf of your own shows: progress, next episode, one-click logging.
function LibShelf({ title, rows, onOpenShow, onMarkNext }) {
  return (
    <div className="shelf">
      <h3>{title}</h3>
      <div className="shelf-row">
        {rows.map(({ s, next }) => {
          let watched = 0;
          let total = 0;
          for (const se of s.seasons) {
            for (const e of se.episodes) {
              if (!isCanonEpisode(se, e)) continue;
              total++;
              if (e.isWatched) watched++;
            }
          }
          return (
            <div className="card shelf-card" key={s.uuid} onClick={() => onOpenShow(s.uuid)}>
              <div className="poster">
                {s.meta?.poster ? (
                  <img src={img(s.meta.poster, "w342")} alt={s.title} loading="lazy" />
                ) : (
                  <div className="fallback">
                    <span>{s.title}</span>
                  </div>
                )}
              </div>
              <div className="info">
                <div className="title">{s.title}</div>
                <div className="next-ep">Next · {epCode(next)}</div>
                <Progress value={watched} max={total} />
                <button
                  className="btn small primary"
                  style={{ width: "100%", marginTop: 7, justifyContent: "center" }}
                  title={next.name || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkNext(s.uuid);
                  }}
                >
                  ✓ Watched {epCode(next)}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecShelf({ title, items, adding, onOpen, onAdd, onDismiss, onMore, moreBusy }) {
  return (
    <div className="shelf">
      <h3>
        {title}
        {onMore && (
          <button className="chip shelf-more" disabled={moreBusy} onClick={onMore}>
            {moreBusy ? "Loading…" : "＋ More"}
          </button>
        )}
      </h3>
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
              {r.tags?.length ? (
                <div className="tags">
                  {r.tags.map((t) => (
                    <span className="tag" key={t}>
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
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
