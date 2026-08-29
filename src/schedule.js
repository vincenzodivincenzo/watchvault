// When does a show actually have something new for you?
//
// The old rule was `airedUnwatched > 0 && watched / total >= 0.85`. That uses
// whole-series completion as a proxy for "caught up", which is wrong in a way
// that gets worse the better you follow a show: a new season of M episodes on
// top of N watched gives N/(N+M), so clearing 0.85 needs M <= 0.176*N. A
// ten-episode season therefore requires 57 prior episodes. Shows followed
// season by season could never qualify, and long-abandoned shows sitting at
// 96% qualified forever.
//
// This asks the real question instead, per season and against the calendar:
// did I finish what existed, and did more then arrive?

const DAY = 86400000;

// How recent an unwatched episode has to be to count as "new" rather than
// "never got round to it".
export const FRESH_DAYS = 548; // ~18 months, two seasons of a yearly show

// Season gaps beyond this are treated as a revival, not a cadence, so a show
// like Bleach with an 18-year hiatus does not predict a next season in 2040.
const MAX_CADENCE_DAYS = 1460; // 4 years

const today = () => new Date().toISOString().slice(0, 10);

export function isEnded(show) {
  return /ended|canceled/i.test(show.meta?.statusText || "");
}

export const isCanonSeason = (se) => !se.isSpecials && se.number !== 0;
export const isCanonEpisode = (se, e) => isCanonSeason(se) && !e.special;

// Aired = a past air date, or a legacy TV Time episode (no TMDB id), which
// carries no dates but definitely aired. A TMDB-synced episode with no air
// date is an announced-but-unaired placeholder and must not count: ONE PIECE
// has a one-episode season 3 of exactly that kind, and counting it makes an
// unwatchable season look like a new drop.
export const isAiredEpisode = (e, now = today()) => {
  if (e.airDate) return e.airDate <= now;
  return !e.tmdb;
};

const hasAired = (ep, now) => isAiredEpisode(ep, now);

// Canonical seasons only. Specials are numbered 0 and are not part of the
// running order, so they must not decide whether you are caught up.
export function seasonRows(show, now = today()) {
  return [...show.seasons]
    .filter(isCanonSeason)
    .sort((a, b) => a.number - b.number)
    .map((se) => {
      const eps = se.episodes.filter((e) => isCanonEpisode(se, e));
      const dates = eps.map((e) => e.airDate).filter(Boolean);
      return {
        number: se.number,
        total: eps.filter((e) => hasAired(e, now)).length,
        watched: eps.filter((e) => e.isWatched).length,
        airedUnwatched: eps.filter((e) => !e.isWatched && hasAired(e, now)).length,
        premiere: dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null,
        finale: dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null,
      };
    });
}

export function lastWatchedDay(show) {
  let last = null;
  for (const se of show.seasons)
    for (const e of se.episodes)
      if (e.isWatched && e.watchedAt) {
        const d = e.watchedAt.slice(0, 10);
        if (!last || d > last) last = d;
      }
  return last;
}

function daysSince(day, now) {
  if (!day) return null;
  return Math.round((Date.parse(now) - Date.parse(day)) / DAY);
}

/**
 * The full signal for a show. Returns { state, since, seasons, frontier }.
 *
 *   newseason    a season you had finished was followed by another that aired
 *   newepisodes  the season you are inside got episodes after your last watch
 *   stalled      there are unwatched aired episodes, but nothing arrived since
 *                you stopped, or what did arrive is older than FRESH_DAYS
 *   dabbled      you never finished a single season, so nothing is "new" yet
 *   unfinished   the show has ended and you did not finish it
 *   caughtup     nothing aired is unwatched, and the show may still return
 *   completed    nothing aired is unwatched, and the show has ended
 *   notstarted / stopped / empty
 */
export function showSignal(show, now = today()) {
  if (show.status === "stopped") return { state: "stopped", since: null };

  const seasons = seasonRows(show, now);
  if (!seasons.length) return { state: "empty", since: null };

  const watched = seasons.reduce((n, s) => n + s.watched, 0);
  if (watched === 0) return { state: "notstarted", since: null };

  const openCount = seasons.reduce((n, s) => n + s.airedUnwatched, 0);
  if (openCount === 0) {
    return { state: isEnded(show) ? "completed" : "caughtup", since: null };
  }

  // An ended show can never gain anything, so it is never "new". This is the
  // single cheapest and most reliable gate: statusText is populated for every
  // show, while air dates are not, and the episode refresh deliberately skips
  // ended shows so their dates never fill in.
  if (isEnded(show)) return { state: "unfinished", since: null };

  // Finishing at least one whole season is what separates following a show
  // from having sampled it. Without this, four episodes of Bleach from 2017
  // make every new Bleach season "new episodes for you".
  const finishedASeason = seasons.some((s) => s.total > 0 && s.watched === s.total);
  if (!finishedASeason) return { state: "dabbled", since: null };

  const last = lastWatchedDay(show);
  const frontier = Math.max(...seasons.filter((s) => s.watched > 0).map((s) => s.number));
  const frontierRow = seasons.find((s) => s.number === frontier);

  // Anything unwatched that aired after the last thing you watched.
  let newest = null;
  for (const se of show.seasons)
    for (const e of se.episodes)
      if (!e.isWatched && e.airDate && hasAired(e, now) && last && e.airDate > last)
        if (!newest || e.airDate > newest) newest = e.airDate;

  let state;
  let since;
  if (frontierRow.airedUnwatched > 0) {
    state = newest ? "newepisodes" : "stalled";
    since = newest;
  } else {
    const later = seasons.find((s) => s.number > frontier && s.airedUnwatched > 0);
    if (!later) return { state: "caughtup", since: null };
    state = "newseason";
    since = later.premiere || newest;
  }

  // Undated but running: keep it, flagged, rather than silently dropping it.
  if (!since) return { state, since: null, undated: true, seasons, frontier };

  if (daysSince(since, now) > FRESH_DAYS) {
    return { state: "stalled", since, seasons, frontier };
  }
  return { state, since, seasons, frontier };
}

export const isNewForYou = (sig) =>
  sig.state === "newseason" || sig.state === "newepisodes";

/**
 * Season cadence. With two or more dated seasons we can say roughly when the
 * next one is due, which is the difference between "nothing to watch" and
 * "nothing to watch until March".
 */
export function seasonCadence(show, now = today()) {
  const prem = seasonRows(show, now)
    .filter((s) => s.premiere)
    .map((s) => s.premiere)
    .sort();
  if (prem.length < 2) return null;

  const gaps = [];
  for (let i = 1; i < prem.length; i++) {
    const g = Math.round((Date.parse(prem[i]) - Date.parse(prem[i - 1])) / DAY);
    // Skip revival-sized gaps so one hiatus does not swallow the median.
    if (g > 0 && g <= MAX_CADENCE_DAYS) gaps.push(g);
  }
  if (!gaps.length) return null;

  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  const median =
    gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);

  const lastPremiere = prem[prem.length - 1];
  const expected = new Date(Date.parse(lastPremiere) + median * DAY)
    .toISOString()
    .slice(0, 10);

  return {
    seasons: prem.length,
    medianGapDays: median,
    lastPremiere,
    expected,
    overdueDays: Math.max(0, daysSince(expected, now)),
    // Two seasons give one gap, which is a guess. Three or more is a pattern.
    confidence: gaps.length >= 2 ? "pattern" : "guess",
  };
}
