import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Stars,
  VaultMark,
  Progress,
  showState,
  isCanonEpisode,
  isAiredEpisode,
 nextEpisode, epCode, } from "../ui.jsx";
import { showSignal, isNewForYou, lastWatchedAt } from "../schedule.js";
import { Book, Cassette } from "../objects.jsx";
import { inProgressEpisode, lastPlayedAt } from "../podcasts.js";
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
// These must be TMDB's own TV genre names, because that is what tvMeta stores
// on each show and what the taste map is therefore keyed by. Shortening
// "Action & Adventure" to "Action" here meant every TV taste lookup for the two
// biggest show genres silently missed and returned zero.
const TV_GENRES = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
  10768: "War & Politics", 37: "Western",
};

export function genreNames(kindApi, ids) {
  const table = kindApi === "movie" ? MOVIE_GENRES : TV_GENRES;
  return (ids || []).map((id) => table[id]).filter(Boolean);
}

// Cards show at most two tags; scoring uses all of them.
function genreTags(kindApi, ids) {
  return genreNames(kindApi, ids).slice(0, 2);
}

function recencyBonus(iso) {
  if (!iso) return 0;
  const days = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (days <= 90) return 100;
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
  // Keyed by genre NAME so it can be compared against the taste map, which is
  // also keyed by name. Counting raw ids made the two incomparable.
  const byGenre = new Map();
  for (const d of list)
    for (const g of genreNames(d.kind === "movie" ? "movie" : "tv", d.genreIds))
      byGenre.set(g, (byGenre.get(g) || 0) + 1);
  return { ids, byGenre };
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

  // A dismissal is evidence against a genre only in proportion to how much you
  // have actually loved that genre. Counting dismissals absolutely meant seven
  // rejected shonen series outweighed nine years of anime, and six rejected
  // dramas outweighed Drama being the single strongest genre in the library.
  // d/(d+t) is self-normalising: it approaches the cap when there is no
  // countervailing evidence, and collapses to nearly zero when there is.
  const MAX_GENRE_PENALTY = 3;
  const genrePenalty = (rec) =>
    genreNames(rec.kind === "movie" ? "movie" : "tv", rec.genreIds).reduce(
      (p, name) => {
        const no = dismissed.byGenre.get(name) || 0;
        if (!no) return p;
        const yes = taste.get(name) || 0;
        return p + (MAX_GENRE_PENALTY * no) / (no + yes);
      },
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

export default function DiscoverView({
  lib,
  update,
  notify,
  onOpenShow,
  onOpenBook,
  onOpenPodcast,
}) {
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
      const sig = showSignal(s);
      const st = showState(s);
      if (st !== "watching" && st !== "newepisodes") continue;
      const next = nextEpisode(s);
      if (!next) continue;
      inProgress.push({ s, st, sig, next, last: lastWatchedAt(s) });
    }
    // "New for you" is ranked by when the episodes ARRIVED, not by when you
    // last watched: a season that dropped last week outranks one you were
    // poking at yesterday. Everything else still sorts by your own recency.
    inProgress.sort((a, b) => (b.last || "").localeCompare(a.last || ""));
    const cutoff = Date.now() - PAUSED_AFTER_DAYS * 86400000;
    const isPaused = (x) => !x.last || new Date(x.last).getTime() < cutoff;
    // Books you are part way through belong in the same row as shows you are
    // part way through. "What am I in the middle of" is one question, and the
    // answer stopped being films-only the moment the shelf gained books.
    const readingNow = (lib.books || [])
      .filter((b) => b.status === "reading")
      .map((b) => ({ kind: "book", book: b, last: b.watchedAt || b.createdAt || "" }));

    // A podcast episode you are part way through is the same kind of fact as a
    // half-read book. Podcasts are the only source here that records a real
    // playhead, so "38% in" is measured rather than inferred.
    const listeningNow = (lib.podcasts || [])
      .map((p) => ({ p, ep: inProgressEpisode(p) }))
      .filter((x) => x.ep)
      .map((x) => ({
        kind: "podcast",
        pod: x.p,
        ep: x.ep,
        last: x.ep.watchedAt || lastPlayedAt(x.p) || "",
      }));

    const continuing = [
      ...inProgress
        .filter((x) => x.st === "watching" && !isPaused(x))
        .map((x) => ({ ...x, kind: "show" })),
      ...readingNow,
      ...listeningNow,
    ].sort((a, b) => (b.last || "").localeCompare(a.last || ""));

    // The same question for podcasts: episodes published after the last one you
    // played, on a show you actually follow. Unlike television this needs no
    // season logic, because a feed is a flat list with real publish dates.
    const FRESH_POD_DAYS = 30;
    const podCutoff = new Date(Date.now() - FRESH_POD_DAYS * 86400000).toISOString();
    const newPodEpisodes = (lib.podcasts || [])
      .map((p) => {
        const last = lastPlayedAt(p);
        if (!last) return null;
        const fresh = p.episodes.filter(
          (e) =>
            !e.isWatched &&
            !e.progress &&
            e.publishedAt &&
            e.publishedAt > last &&
            e.publishedAt > podCutoff
        );
        if (!fresh.length) return null;
        return { kind: "podcast", pod: p, ep: fresh[0], count: fresh.length, last: fresh[0].publishedAt };
      })
      .filter(Boolean);

    return {
      newEpisodes: inProgress
        .filter((x) => isNewForYou(x.sig))
        .sort((a, b) => (b.sig.since || "").localeCompare(a.sig.since || ""))
        .map((x) => ({ ...x, kind: "show" }))
        .concat(newPodEpisodes)
        .sort((a, b) =>
          ((b.sig?.since || b.last) || "").localeCompare((a.sig?.since || a.last) || "")
        )
        .slice(0, 12),
      continuing: continuing.slice(0, 12),
      pickBackUp: inProgress
        .filter((x) => x.st === "watching" && isPaused(x))
        .map((x) => ({ ...x, kind: "show" }))
        .slice(0, 12),
    };
  }, [lib.shows, lib.books, lib.podcasts]);

  function finishBook(uuid) {
    let title = null;
    update((next) => {
      const b = (next.books || []).find((x) => x.uuid === uuid);
      if (!b) return;
      b.status = "read";
      b.isWatched = true;
      if (!b.watchedAt) b.watchedAt = new Date().toISOString();
      title = b.title;
    });
    if (title) notify(`✓ ${title} finished`);
  }

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
          ✕ hides a title and nudges its genres down
        </span>
      </div>

      {libraryShelves.continuing.length > 0 && (
        <LibShelf
          title="Currently"
          rows={libraryShelves.continuing}
          onOpenShow={onOpenShow}
          onOpenBook={onOpenBook}
          onOpenPodcast={onOpenPodcast}
          onMarkNext={markNext}
          onFinishBook={finishBook}
        />
      )}
      {libraryShelves.newEpisodes.length > 0 && (
        <LibShelf
          title="New episodes for you"
          rows={libraryShelves.newEpisodes}
          onOpenShow={onOpenShow}
          onOpenBook={onOpenBook}
          onOpenPodcast={onOpenPodcast}
          onMarkNext={markNext}
          onFinishBook={finishBook}
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
          onOpenBook={onOpenBook}
          onOpenPodcast={onOpenPodcast}
          onMarkNext={markNext}
          onFinishBook={finishBook}
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
function LibShelf({
  title,
  rows,
  onOpenShow,
  onOpenBook,
  onOpenPodcast,
  onMarkNext,
  onFinishBook,
}) {
  return (
    <div className="shelf">
      <h3>{title}</h3>
      <div className="shelf-row">
        {rows.map((row) =>
          row.kind === "podcast" ? (
            <PodcastShelfCard
              key={row.pod.uuid}
              pod={row.pod}
              ep={row.ep}
              count={row.count}
              onOpen={() => onOpenPodcast(row.pod.uuid)}
            />
          ) : row.kind === "book" ? (
            <BookShelfCard
              key={row.book.uuid}
              book={row.book}
              onOpen={() => onOpenBook(row.book.uuid)}
              onFinish={() => onFinishBook(row.book.uuid)}
            />
          ) : (
            <ShowShelfCard
              key={row.s.uuid}
              show={row.s}
              next={row.next}
              onOpen={() => onOpenShow(row.s.uuid)}
              onMarkNext={() => onMarkNext(row.s.uuid)}
            />
          )
        )}
      </div>
    </div>
  );
}

// A podcast on the home shelf. The reels already carry the position, so the
// caption says which episode rather than repeating the number.
function PodcastShelfCard({ pod, ep, count, onOpen }) {
  return (
    <div className="shelf-card pod-shelf-card">
      <Cassette podcast={pod} onClick={onOpen} caption={false} />
      <div className="info">
        <div className="title">{pod.title}</div>
        <div className="next-ep">
          {count > 1 ? `${count} new · ` : ""}
          {ep?.title || pod.author || ""}
        </div>
      </div>
    </div>
  );
}

function ShowShelfCard({ show: s, next, onOpen, onMarkNext }) {
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
    <div className="card shelf-card" onClick={onOpen}>
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
            onMarkNext();
          }}
        >
          ✓ Watched {epCode(next)}
        </button>
      </div>
    </div>
  );
}

// A book on the home shelf is the same object as on the Books shelf, so the
// two never drift apart, with the one action that finishes it.
function BookShelfCard({ book, onOpen, onFinish }) {
  return (
    <div className="shelf-card book-shelf-card">
      <Book book={book} onClick={onOpen} caption={false} />
      <div className="info">
        <div className="title">{book.title}</div>
        <div className="next-ep">{book.author || "Reading"}</div>
        <button
          className="btn small primary"
          style={{ width: "100%", marginTop: 7, justifyContent: "center" }}
          onClick={(e) => {
            e.stopPropagation();
            onFinish();
          }}
        >
          ✓ Finished
        </button>
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
    <Modal onClose={onClose} title={rec.title || rec.name}>
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
