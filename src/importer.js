// Converts TV Time export JSON (movies / series) into the WatchVault
// library format, and merges imports into an existing library.

function movieFromTvTime(m) {
  return {
    uuid: m.uuid,
    title: m.title,
    year: m.year || null,
    imdb: m.id?.imdb || null,
    tvdb: m.id?.tvdb || null,
    isWatched: !!m.is_watched,
    watchedAt: m.watched_at || null,
    isFavorite: !!m.is_favorite,
    rewatchCount: m.rewatch_count || 0,
    rating: null,
    createdAt: m.created_at || null,
    meta: null,
  };
}

function showFromTvTime(s) {
  return {
    uuid: s.uuid,
    title: s.title,
    imdb: s.id?.imdb || null,
    tvdb: s.id?.tvdb || null,
    status: s.status || null, // up_to_date | continuing | stopped | not_started_yet
    isFavorite: !!s.is_favorite,
    rating: null,
    createdAt: s.created_at || null,
    meta: null,
    seasons: (s.seasons || []).map((se) => ({
      number: se.number,
      isSpecials: !!se.is_specials,
      episodes: (se.episodes || []).map((e) => ({
        tvdb: e.id?.tvdb || null,
        imdb: e.id?.imdb || null,
        tmdb: null,
        number: e.number,
        name: e.name || null,
        special: !!e.special,
        airDate: null,
        isWatched: !!e.is_watched,
        watchedAt: e.watched_at || null,
        rewatchCount: e.rewatch_count || 0,
      })),
    })),
  };
}

function detectKind(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const first = parsed[0];
  if (first && typeof first === "object") {
    if ("seasons" in first) return "series";
    if ("is_watched" in first && "watched_at" in first) return "movies";
  }
  return null;
}

function movieKey(m) {
  return m.imdb || (m.tvdb ? `tvdb-m-${m.tvdb}` : null) || m.uuid || m.title;
}

function showKey(s) {
  return (s.tvdb ? `tvdb-s-${s.tvdb}` : null) || s.imdb || s.uuid || s.title;
}

function mergeEpisodes(existing, incoming) {
  const byNum = new Map(existing.map((e) => [e.number, e]));
  for (const inc of incoming) {
    const cur = byNum.get(inc.number);
    if (!cur) {
      existing.push(inc);
    } else {
      // Union watch state: never un-watch on import.
      if (inc.isWatched && !cur.isWatched) {
        cur.isWatched = true;
        cur.watchedAt = inc.watchedAt || cur.watchedAt;
      }
      cur.rewatchCount = Math.max(cur.rewatchCount || 0, inc.rewatchCount || 0);
      cur.tvdb = cur.tvdb ?? inc.tvdb;
      cur.name = cur.name || inc.name;
    }
  }
  existing.sort((a, b) => a.number - b.number);
}

function mergeShow(existing, incoming) {
  existing.isFavorite = existing.isFavorite || incoming.isFavorite;
  existing.rating = existing.rating ?? incoming.rating;
  existing.status = existing.status || incoming.status;
  const byNum = new Map(existing.seasons.map((s) => [s.number, s]));
  for (const inc of incoming.seasons) {
    const cur = byNum.get(inc.number);
    if (!cur) existing.seasons.push(inc);
    else mergeEpisodes(cur.episodes, inc.episodes);
  }
  existing.seasons.sort((a, b) => a.number - b.number);
}

// files: [{name, text}]. Returns {library, report}.
// Pass an existing library to merge into it.
export function importTvTimeFiles(files, base) {
  const lib = base || {
    version: 1,
    settings: { tmdbKey: "" },
    movies: [],
    shows: [],
  };
  const report = { moviesAdded: 0, moviesMerged: 0, showsAdded: 0, showsMerged: 0, skippedFiles: [] };

  const movieIndex = new Map(lib.movies.map((m) => [movieKey(m), m]));
  const showIndex = new Map(lib.shows.map((s) => [showKey(s), s]));

  for (const f of files) {
    let parsed;
    try {
      parsed = JSON.parse(f.text);
    } catch {
      report.skippedFiles.push(`${f.name}: not valid JSON`);
      continue;
    }

    // Accept a WatchVault backup file as well.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.movies && parsed.shows) {
      importTvTimeBackup(parsed, lib, movieIndex, showIndex, report);
      continue;
    }

    const kind = detectKind(parsed);
    if (kind === "movies") {
      for (const raw of parsed) {
        const m = movieFromTvTime(raw);
        const key = movieKey(m);
        const cur = movieIndex.get(key);
        if (!cur) {
          lib.movies.push(m);
          movieIndex.set(key, m);
          report.moviesAdded++;
        } else {
          if (m.isWatched && !cur.isWatched) {
            cur.isWatched = true;
            cur.watchedAt = m.watchedAt || cur.watchedAt;
          }
          cur.isFavorite = cur.isFavorite || m.isFavorite;
          cur.rewatchCount = Math.max(cur.rewatchCount || 0, m.rewatchCount || 0);
          report.moviesMerged++;
        }
      }
    } else if (kind === "series") {
      for (const raw of parsed) {
        const s = showFromTvTime(raw);
        const key = showKey(s);
        const cur = showIndex.get(key);
        if (!cur) {
          lib.shows.push(s);
          showIndex.set(key, s);
          report.showsAdded++;
        } else {
          mergeShow(cur, s);
          report.showsMerged++;
        }
      }
    } else {
      report.skippedFiles.push(`${f.name}: not a recognized TV Time export`);
    }
  }
  return { library: lib, report };
}

function importTvTimeBackup(backup, lib, movieIndex, showIndex, report) {
  for (const m of backup.movies || []) {
    const key = movieKey(m);
    if (!movieIndex.has(key)) {
      lib.movies.push(m);
      movieIndex.set(key, m);
      report.moviesAdded++;
    } else report.moviesMerged++;
  }
  for (const s of backup.shows || []) {
    const key = showKey(s);
    if (!showIndex.has(key)) {
      lib.shows.push(s);
      showIndex.set(key, s);
      report.showsAdded++;
    } else report.showsMerged++;
  }
}

// Movie ratings from the GDPR ratings-live-votes.csv.
// vote_key ends in a vote-option id; TV Time used two schemes:
//   3        → top vote of the old 3-point scale
//   27/28/29 → Bad / Good / Awesome in the newer "How was it?" sheet
export const MOVIE_VOTE_TO_STARS = { 3: 5, 27: 2, 28: 4, 29: 5 };

// votes: [{uuid, vote}] — applies only where no rating is set yet.
export function applyMovieVotes(lib, votes) {
  const byUuid = new Map(lib.movies.map((m) => [m.uuid, m]));
  let applied = 0;
  for (const v of votes) {
    const stars = MOVIE_VOTE_TO_STARS[v.vote];
    const movie = byUuid.get(v.uuid);
    if (movie && stars && movie.rating == null) {
      movie.rating = stars;
      applied++;
    }
  }
  return applied;
}

// Ratings from the GDPR tv_show_rate.csv: [{name, rating}]
export function applyShowRatings(lib, ratings) {
  let applied = 0;
  for (const r of ratings) {
    const show = lib.shows.find(
      (s) => s.title.toLowerCase() === r.name.toLowerCase()
    );
    if (show && r.rating >= 1 && r.rating <= 5) {
      show.rating = r.rating;
      applied++;
    }
  }
  return applied;
}
