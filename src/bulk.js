// Bulk-log detection: separates "I watched this on that day" from
// "I logged my old history that day", so time-based analytics only
// reflect real viewing behavior. Totals always keep everything.
//
// Heuristics (per calendar day):
//  - more than MAX_EPS_PER_DAY episodes marked that day → the whole day is a log-in session
//  - more than MAX_SHOW_EPS_PER_DAY episodes of ONE show that day → that show's day is bulk
//  - more than MAX_MOVIES_PER_DAY movies that day → those movies are bulk-logged

export const MAX_EPS_PER_DAY = 16;
export const MAX_SHOW_EPS_PER_DAY = 12;
export const MAX_MOVIES_PER_DAY = 4;

// Mutates lib, returns a report. Safe to re-run (idempotent).
export function detectBulkFlags(lib) {
  const dayEps = new Map(); // day → [{show, ep}]
  const dayMovies = new Map(); // day → [movie]

  for (const s of lib.shows)
    for (const se of s.seasons)
      for (const e of se.episodes)
        if (e.isWatched && e.watchedAt) {
          const d = e.watchedAt.slice(0, 10);
          if (!dayEps.has(d)) dayEps.set(d, []);
          dayEps.get(d).push({ show: s, ep: e });
        }
  for (const m of lib.movies)
    if (m.isWatched && m.watchedAt) {
      const d = m.watchedAt.slice(0, 10);
      if (!dayMovies.has(d)) dayMovies.set(d, []);
      dayMovies.get(d).push(m);
    }

  let flaggedEps = 0;
  let flaggedMovies = 0;
  const flaggedDays = new Set();

  for (const [d, list] of dayEps) {
    if (list.length > MAX_EPS_PER_DAY) {
      for (const { ep } of list)
        if (!ep.bulk) {
          ep.bulk = true;
          flaggedEps++;
        }
      flaggedDays.add(d);
      continue;
    }
    // Per-show check: one show dominating a day across many episodes.
    const perShow = new Map();
    for (const x of list) {
      if (!perShow.has(x.show.uuid)) perShow.set(x.show.uuid, []);
      perShow.get(x.show.uuid).push(x.ep);
    }
    for (const eps of perShow.values())
      if (eps.length > MAX_SHOW_EPS_PER_DAY) {
        for (const ep of eps)
          if (!ep.bulk) {
            ep.bulk = true;
            flaggedEps++;
          }
        flaggedDays.add(d);
      }
  }

  for (const [d, list] of dayMovies)
    if (list.length > MAX_MOVIES_PER_DAY) {
      for (const m of list)
        if (!m.bulk) {
          m.bulk = true;
          flaggedMovies++;
        }
      flaggedDays.add(d);
    }

  return { flaggedEps, flaggedMovies, days: flaggedDays.size };
}

export function clearBulkFlags(lib) {
  let cleared = 0;
  for (const s of lib.shows)
    for (const se of s.seasons)
      for (const e of se.episodes)
        if (e.bulk) {
          delete e.bulk;
          cleared++;
        }
  for (const m of lib.movies)
    if (m.bulk) {
      delete m.bulk;
      cleared++;
    }
  return cleared;
}

export function countBulkFlags(lib) {
  let n = 0;
  for (const s of lib.shows)
    for (const se of s.seasons) for (const e of se.episodes) if (e.bulk) n++;
  for (const m of lib.movies) if (m.bulk) n++;
  return n;
}
