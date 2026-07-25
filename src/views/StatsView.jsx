import React, { useMemo, useState } from "react";
import { fmtDate, isCanonEpisode } from "../ui.jsx";

// Chart colors come from theme CSS variables (validated per surface).
const C_MOVIES = "var(--c-movies)";
const C_EPISODES = "var(--c-episodes)";
const HEAT = ["var(--heat-1)", "var(--heat-2)", "var(--heat-3)", "var(--heat-4)"]; // 1 · 2-4 · 5-9 · 10+

function heatColor(count) {
  if (count === 0) return "var(--heat-0)";
  if (count === 1) return HEAT[0];
  if (count <= 4) return HEAT[1];
  if (count <= 9) return HEAT[2];
  return HEAT[3];
}

function fmtDuration(mins) {
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  return `${hours}h ${Math.round(mins % 60)}m`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function weekdayIndex(d) {
  return (new Date(`${d}T12:00:00`).getDay() + 6) % 7; // Monday-first
}

// Aggregates a list of events into one chart bucket.
function summarize(evts) {
  const out = { movies: 0, episodes: 0, minutes: 0, shows: new Map(), genres: new Map() };
  for (const e of evts) {
    out[e.kind === "movie" ? "movies" : "episodes"]++;
    out.minutes += e.minutes;
    if (e.kind === "episode" && !e.hidden)
      out.shows.set(e.title, (out.shows.get(e.title) || 0) + 1);
    for (const g of e.genres) out.genres.set(g, (out.genres.get(g) || 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  out.topShow = top(out.shows);
  out.topGenre = top(out.genres);
  return out;
}

export default function StatsView({ lib }) {
  const [tip, setTip] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [gran, setGran] = useState("year"); // year | month | week
  const [selYear, setSelYear] = useState(null);
  const [selBucket, setSelBucket] = useState(null); // index of clicked bar

  const stats = useMemo(() => {
    const moviesWatched = lib.movies.filter((m) => m.isWatched);

    // One event per watched item with a date — the basis for every time chart.
    const allEvents = [];
    for (const m of moviesWatched) {
      if (m.watchedAt)
        allEvents.push({
          d: m.watchedAt.slice(0, 10),
          kind: "movie",
          title: m.title,
          minutes: m.meta?.runtime || 110,
          genres: m.meta?.genres || [],
          bulk: !!m.bulk,
        });
    }
    let movieMinutes = 0;
    for (const m of moviesWatched)
      movieMinutes += (m.meta?.runtime || 110) * (1 + (m.rewatchCount || 0));

    let episodesWatched = 0;
    let episodeMinutes = 0;
    const byShow = [];
    for (const s of lib.shows) {
      const runtime = s.meta?.episodeRuntime || 40;
      let count = 0;
      for (const se of s.seasons)
        for (const e of se.episodes)
          if (e.isWatched) {
            count++;
            episodeMinutes += runtime * (1 + (e.rewatchCount || 0));
            if (e.watchedAt)
              allEvents.push({
                d: e.watchedAt.slice(0, 10),
                kind: "episode",
                title: s.title,
                code: se.isSpecials
                  ? "SP"
                  : `S${String(se.number).padStart(2, "0")}E${String(e.number).padStart(2, "0")}`,
                name: e.name,
                minutes: runtime,
                genres: s.meta?.genres || [],
                hidden: !!s.hideFromStats,
                bulk: !!e.bulk,
              });
          }
      episodesWatched += count;
      if (count > 0 && !s.hideFromStats) byShow.push({ name: s.title, count });
    }
    byShow.sort((a, b) => b.count - a.count);
    allEvents.sort((a, b) => a.d.localeCompare(b.d));
    // Time-based charts only see real viewing events — bulk-logged history
    // (importing your past, "mark all" sweeps) stays in totals but not here.
    const events = allEvents.filter((e) => !e.bulk);
    const bulkCount = allEvents.length - events.length;

    // Per-day map for calendar + binge records.
    const days = new Map();
    for (const e of events) {
      if (!days.has(e.d)) days.set(e.d, []);
      days.get(e.d).push(e);
    }

    // Streaks over unique dates.
    const dates = [...days.keys()].sort();
    let bestStreak = 0, bestStreakEnd = null, cur = 0, prev = null;
    for (const d of dates) {
      const diff = prev
        ? Math.round((new Date(`${d}T12:00:00`) - new Date(`${prev}T12:00:00`)) / 86400000)
        : null;
      cur = diff === 1 ? cur + 1 : 1;
      if (cur > bestStreak) {
        bestStreak = cur;
        bestStreakEnd = d;
      }
      prev = d;
    }

    // Biggest single day.
    let binge = null;
    for (const [d, evts] of days)
      if (!binge || evts.length > binge.count)
        binge = { d, count: evts.length, ...summarize(evts) };

    // Most active month.
    const byMonth = new Map();
    for (const e of events) {
      const k = e.d.slice(0, 7);
      byMonth.set(k, (byMonth.get(k) || 0) + 1);
    }
    let topMonth = null;
    for (const [k, n] of byMonth)
      if (!topMonth || n > topMonth.n) topMonth = { k, n };

    // Weekday profile.
    const weekdays = Array.from({ length: 7 }, () => ({ movies: 0, episodes: 0 }));
    for (const e of events)
      weekdays[weekdayIndex(e.d)][e.kind === "movie" ? "movies" : "episodes"]++;

    // Per-show progress (aired episodes only) → completion + taste profile.
    const today = new Date().toISOString().slice(0, 10);
    const progressList = [];
    for (const s of lib.shows) {
      let watched = 0, aired = 0;
      for (const se of s.seasons) {
        for (const e of se.episodes) {
          if (!isCanonEpisode(se, e)) continue;
          if (e.airDate && e.airDate > today) continue;
          aired++;
          if (e.isWatched) watched++;
        }
      }
      if (watched > 0 && aired > 0)
        progressList.push({
          s,
          pct: watched / aired,
          complete: watched >= aired,
        });
    }
    const started = progressList.length;
    const completed = progressList.filter((p) => p.complete).length;

    // Which genres do you actually finish? (needs TMDB genres)
    const genreDone = new Map(); // genre → {started, completed}
    for (const p of progressList)
      for (const g of p.s.meta?.genres || []) {
        if (!genreDone.has(g)) genreDone.set(g, { started: 0, completed: 0 });
        const gd = genreDone.get(g);
        gd.started++;
        if (p.complete) gd.completed++;
      }
    const genreCompletion = [...genreDone.entries()]
      .filter(([, v]) => v.started >= 3)
      .map(([name, v]) => ({ name, ...v, pct: v.completed / v.started }))
      .sort((a, b) => b.pct - a.pct || b.started - a.started)
      .slice(0, 7);

    // Where do you give up? Explicitly stopped shows and their progress point.
    const stoppedShows = progressList.filter((p) => p.s.status === "stopped");
    const abandon = stoppedShows.length
      ? {
          count: stoppedShows.length,
          avgPct:
            stoppedShows.reduce((t, p) => t + p.pct, 0) / stoppedShows.length,
        }
      : null;

    // Episode runtime preference (share of TV time by format).
    const runtimeSplit = { short: 0, medium: 0, long: 0 };
    for (const s of lib.shows) {
      const rt = s.meta?.episodeRuntime;
      if (!rt) continue;
      let count = 0;
      for (const se of s.seasons)
        for (const e of se.episodes) if (e.isWatched) count++;
      const cls = rt <= 25 ? "short" : rt <= 45 ? "medium" : "long";
      runtimeSplit[cls] += count * rt;
    }
    const runtimeTotal = runtimeSplit.short + runtimeSplit.medium + runtimeSplit.long;

    // Rewatches (comfort factor).
    let rewatches = lib.movies.reduce((t, m) => t + (m.rewatchCount || 0), 0);
    for (const s of lib.shows)
      for (const se of s.seasons)
        for (const e of se.episodes) rewatches += e.rewatchCount || 0;

    // Release decades of watched movies.
    const decades = new Map();
    for (const m of moviesWatched)
      if (m.year) {
        const dec = Math.floor(m.year / 10) * 10;
        decades.set(dec, (decades.get(dec) || 0) + 1);
      }
    const decadeRows = [...decades.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dec, count]) => ({ label: `${dec}s`, count }));

    // Genres (respecting hideFromStats).
    const genres = new Map();
    for (const m of moviesWatched)
      for (const g of m.meta?.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
    for (const s of lib.shows.filter((x) => !x.hideFromStats)) {
      const startedShow = s.seasons.some((se) => se.episodes.some((e) => e.isWatched));
      if (startedShow)
        for (const g of s.meta?.genres || []) genres.set(g, (genres.get(g) || 0) + 1);
    }
    const topGenres = [...genres.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // You vs the world (needs OMDb data + your ratings).
    const rated = [
      ...lib.movies.filter((m) => m.rating && m.omdb?.imdb).map((m) => ({
        title: m.title, kind: "movie", mine: m.rating * 2, world: m.omdb.imdb,
      })),
      ...lib.shows.filter((s) => s.rating && s.omdb?.imdb).map((s) => ({
        title: s.title, kind: "show", mine: s.rating * 2, world: s.omdb.imdb,
      })),
    ];
    let vsWorld = null;
    if (rated.length >= 3) {
      const avgMine = rated.reduce((t, r) => t + r.mine, 0) / rated.length;
      const avgWorld = rated.reduce((t, r) => t + r.world, 0) / rated.length;
      const gaps = [...rated].sort((a, b) => (b.mine - b.world) - (a.mine - a.world));
      vsWorld = {
        n: rated.length,
        avgMine,
        avgWorld,
        youLoved: gaps.slice(0, 4).filter((g) => g.mine > g.world),
        worldLoved: gaps.slice(-4).reverse().filter((g) => g.world > g.mine),
      };
    }

    // True pace, from real (non-bulk) episode events.
    const epDays = new Map();
    for (const e of events)
      if (e.kind === "episode")
        epDays.set(e.d, (epDays.get(e.d) || 0) + 1);
    const pace = epDays.size
      ? {
          activeDays: epDays.size,
          avgPerDay:
            [...epDays.values()].reduce((a, b) => a + b, 0) / epDays.size,
          realBinge: Math.max(...epDays.values()),
        }
      : null;

    return {
      moviesWatched: moviesWatched.length,
      toWatch: lib.movies.length - moviesWatched.length,
      episodesWatched,
      movieMinutes,
      episodeMinutes,
      events,
      bulkCount,
      days,
      bestStreak,
      bestStreakEnd,
      binge,
      topMonth,
      weekdays,
      started,
      completed,
      genreCompletion,
      abandon,
      runtimeSplit,
      runtimeTotal,
      rewatches,
      pace,
      decadeRows,
      topShows: byShow.slice(0, 8),
      topGenres,
      vsWorld,
      hasMeta: lib.movies.some((m) => m.meta) || lib.shows.some((s) => s.meta),
    };
  }, [lib]);

  const allYears = useMemo(() => {
    const ys = new Set(stats.events.map((e) => e.d.slice(0, 4)));
    return [...ys].sort();
  }, [stats.events]);
  const year = selYear || allYears[allYears.length - 1] || String(new Date().getFullYear());

  // Buckets for the active granularity.
  const buckets = useMemo(() => {
    if (gran === "year")
      return allYears.map((y) => ({
        label: y,
        key: y,
        evts: stats.events.filter((e) => e.d.startsWith(y)),
      }));
    if (gran === "month")
      return MONTHS.map((label, i) => {
        const mm = String(i + 1).padStart(2, "0");
        return {
          label,
          key: `${year}-${mm}`,
          evts: stats.events.filter((e) => e.d.startsWith(`${year}-${mm}`)),
        };
      });
    // week: ISO-ish week buckets of the selected year
    const jan1 = new Date(`${year}-01-01T12:00:00`);
    const offset = (jan1.getDay() + 6) % 7;
    const weekOf = (d) => {
      const doy = Math.round((new Date(`${d}T12:00:00`) - jan1) / 86400000);
      return Math.floor((doy + offset) / 7);
    };
    const n = weekOf(`${year}-12-31`) + 1;
    const arr = Array.from({ length: n }, (_, i) => ({
      label: `W${i + 1}`,
      key: `${year}-W${i + 1}`,
      evts: [],
    }));
    for (const e of stats.events)
      if (e.d.startsWith(year)) arr[weekOf(e.d)]?.evts.push(e);
    return arr;
  }, [gran, year, allYears, stats.events]);

  const summarized = useMemo(
    () => buckets.map((b) => ({ ...b, ...summarize(b.evts) })),
    [buckets]
  );
  const maxBucket = Math.max(1, ...summarized.map((b) => b.movies + b.episodes));
  const bucketDetail = selBucket != null ? summarized[selBucket] : null;

  function showTip(e, html) {
    setTip({ x: e.clientX + 12, y: e.clientY + 12, html });
  }

  function clickBucket(i) {
    if (gran === "year") {
      // Drill down: year → its months.
      setSelYear(summarized[i].label);
      setGran("month");
      setSelBucket(null);
    } else {
      setSelBucket(selBucket === i ? null : i);
    }
  }

  // Calendar (driven by the day map).
  const weeks = useMemo(() => {
    const first = new Date(`${year}-01-01T00:00:00`);
    const last = new Date(`${year}-12-31T00:00:00`);
    const start = new Date(first);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const cols = [];
    let cursor = new Date(start);
    while (cursor <= last) {
      const col = [];
      for (let i = 0; i < 7; i++) {
        const iso = cursor.toISOString().slice(0, 10);
        const inYear = iso.slice(0, 4) === year;
        const evts = inYear ? stats.days.get(iso) || [] : [];
        col.push({
          iso,
          inYear,
          count: evts.length,
          movies: evts.filter((e) => e.kind === "movie").length,
          episodes: evts.filter((e) => e.kind === "episode").length,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      cols.push(col);
    }
    return cols;
  }, [year, stats.days]);

  const monthLabels = useMemo(() => {
    const labels = [];
    let prevMonth = -1;
    weeks.forEach((col, i) => {
      const firstInYear = col.find((c) => c.inYear);
      if (!firstInYear) return;
      const m = Number(firstInYear.iso.slice(5, 7)) - 1;
      if (m !== prevMonth) {
        labels.push({ index: i, label: MONTHS[m] });
        prevMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  const dayEvents = selectedDay ? stats.days.get(selectedDay) || [] : [];
  const maxWeekday = Math.max(1, ...stats.weekdays.map((w) => w.movies + w.episodes));
  const maxDecade = Math.max(1, ...stats.decadeRows.map((d) => d.count));
  const favWeekday =
    WEEKDAYS[
      stats.weekdays.indexOf(
        [...stats.weekdays].sort((a, b) => b.movies + b.episodes - (a.movies + a.episodes))[0]
      )
    ];

  return (
    <div>
      <div className="stat-tiles">
        <div className="tile">
          <div className="label">Movies watched</div>
          <div className="value">{stats.moviesWatched}</div>
          <div className="sub">{stats.toWatch} on your watchlist</div>
        </div>
        <div className="tile">
          <div className="label">Episodes watched</div>
          <div className="value">{stats.episodesWatched.toLocaleString()}</div>
          <div className="sub">
            {stats.completed}/{stats.started} started shows completed
          </div>
        </div>
        <div className="tile">
          <div className="label">Movie time</div>
          <div className="value" style={{ color: C_MOVIES }}>
            {fmtDuration(stats.movieMinutes)}
          </div>
          <div className="sub">{stats.hasMeta ? "from real runtimes" : "estimated"}</div>
        </div>
        <div className="tile">
          <div className="label">TV time</div>
          <div className="value" style={{ color: C_EPISODES }}>
            {fmtDuration(stats.episodeMinutes)}
          </div>
          <div className="sub">{stats.hasMeta ? "from real runtimes" : "estimated"}</div>
        </div>
      </div>

      {/* Records */}
      <div className="stat-tiles">
        <div className="tile">
          <div className="label">Longest streak</div>
          <div className="value small">{stats.bestStreak} days</div>
          <div className="sub">
            {stats.bestStreakEnd ? `ending ${fmtDate(stats.bestStreakEnd)}` : "—"}
          </div>
        </div>
        <div className="tile">
          <div className="label">Biggest day</div>
          <div className="value small">
            {stats.binge ? `${stats.binge.count} titles` : "—"}
          </div>
          <div className="sub">
            {stats.binge
              ? `${fmtDate(stats.binge.d)}${stats.binge.topShow ? ` · mostly ${stats.binge.topShow[0]}` : ""}`
              : ""}
          </div>
        </div>
        <div className="tile">
          <div className="label">Most active month</div>
          <div className="value small">
            {stats.topMonth
              ? `${MONTHS[Number(stats.topMonth.k.slice(5, 7)) - 1]} ${stats.topMonth.k.slice(0, 4)}`
              : "—"}
          </div>
          <div className="sub">
            {stats.topMonth ? `${stats.topMonth.n} titles watched` : ""}
          </div>
        </div>
        <div className="tile">
          <div className="label">Favorite weekday</div>
          <div className="value small">{favWeekday}</div>
          <div className="sub">your most common watch day</div>
        </div>
      </div>

      {/* Activity chart with granularity switcher */}
      <div className="panel">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ marginBottom: 0 }}>Watch activity</h3>
          <div className="chips" style={{ marginBottom: 0 }}>
            {["year", "month", "week"].map((g) => (
              <button
                key={g}
                className={`chip ${gran === g ? "active" : ""}`}
                onClick={() => {
                  setGran(g);
                  setSelBucket(null);
                }}
              >
                By {g}
              </button>
            ))}
            {gran !== "year" && (
              <select
                value={year}
                onChange={(e) => {
                  setSelYear(e.target.value);
                  setSelBucket(null);
                }}
              >
                {allYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="legend" style={{ marginBottom: 0, marginLeft: "auto" }}>
            <span className="key">
              <span className="swatch" style={{ background: C_MOVIES }} /> Movies
            </span>
            <span className="key">
              <span className="swatch" style={{ background: C_EPISODES }} /> Episodes
            </span>
          </span>
        </div>
        <div className="barchart-wrap">
          <div className={`barchart ${gran === "week" ? "dense" : ""}`}>
            {summarized.map((b, i) => {
              const totalH = ((b.movies + b.episodes) / maxBucket) * 100;
              const epH =
                b.movies + b.episodes > 0
                  ? (b.episodes / (b.movies + b.episodes)) * totalH
                  : 0;
              const mvH = totalH - epH;
              const showLabel =
                gran !== "week" || i % 4 === 0 || i === summarized.length - 1;
              return (
                <div
                  className={`col ${selBucket === i ? "sel" : ""}`}
                  key={b.key}
                  onMouseMove={(e) =>
                    showTip(
                      e,
                      `<b>${b.label}${gran !== "year" ? ` ${year}` : ""}</b>${b.movies} movies · ${b.episodes} episodes · ${fmtDuration(b.minutes)}`
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                  onClick={() => clickBucket(i)}
                >
                  <div className="stack" style={{ height: "100%" }}>
                    <div style={{ flex: 1 }} />
                    {b.movies > 0 && (
                      <div
                        className="seg"
                        style={{ height: `${mvH}%`, background: C_MOVIES }}
                      />
                    )}
                    {b.episodes > 0 && (
                      <div
                        className="seg"
                        style={{ height: `${epH}%`, background: C_EPISODES }}
                      />
                    )}
                  </div>
                  {showLabel && <span className="xlabel">{b.label}</span>}
                </div>
              );
            })}
          </div>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          {gran === "year"
            ? "Click a year to drill into its months."
            : "Click a bar for that period's detail."}
          {stats.bulkCount > 0 &&
            ` · ${stats.bulkCount.toLocaleString()} bulk-logged items (imported history, "mark all" sweeps) are excluded from time charts — they still count in totals.`}
        </p>
        {bucketDetail && gran !== "year" && (
          <div className="day-detail">
            <h4>
              {bucketDetail.label} {year} — {bucketDetail.movies} movies ·{" "}
              {bucketDetail.episodes} episodes · {fmtDuration(bucketDetail.minutes)}
            </h4>
            <div className="day-group">
              {bucketDetail.topShow && (
                <span className="day-item">
                  Top show: {bucketDetail.topShow[0]} ({bucketDetail.topShow[1]} eps)
                </span>
              )}
              {bucketDetail.topGenre && (
                <span className="day-item">Top genre: {bucketDetail.topGenre[0]}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Calendar */}
      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <h3 style={{ marginBottom: 0 }}>Watch calendar</h3>
          <select
            value={year}
            onChange={(e) => {
              setSelYear(e.target.value);
              setSelectedDay(null);
            }}
          >
            {allYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="cal-legend">
            less
            <i style={{ background: "var(--heat-0)" }} />
            {HEAT.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
            more
          </span>
        </div>
        <div className="cal-scroll">
          <div className="cal-months">
            {monthLabels.map((m) => (
              <span key={m.label + m.index} style={{ left: m.index * 15 }}>
                {m.label}
              </span>
            ))}
          </div>
          <div className="cal-grid">
            {weeks.map((col, i) => (
              <div className="cal-col" key={i}>
                {col.map((c) => (
                  <div
                    key={c.iso}
                    className={`cal-cell ${selectedDay === c.iso ? "sel" : ""}`}
                    style={{
                      background: c.inYear ? heatColor(c.count) : "transparent",
                      cursor: c.count ? "pointer" : "default",
                    }}
                    onMouseMove={(e) =>
                      c.inYear &&
                      showTip(
                        e,
                        `<b>${fmtDate(c.iso)}</b>${
                          c.count
                            ? `${c.movies} movie${c.movies === 1 ? "" : "s"} · ${c.episodes} episode${c.episodes === 1 ? "" : "s"}`
                            : "nothing watched"
                        }`
                      )
                    }
                    onMouseLeave={() => setTip(null)}
                    onClick={() =>
                      c.count && setSelectedDay(selectedDay === c.iso ? null : c.iso)
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        {selectedDay && dayEvents.length > 0 && (
          <div className="day-detail">
            <h4>{fmtDate(selectedDay)}</h4>
            {dayEvents.some((e) => e.kind === "movie") && (
              <div className="day-group">
                <span className="day-kind" style={{ color: C_MOVIES }}>
                  Movies
                </span>
                {dayEvents
                  .filter((e) => e.kind === "movie")
                  .map((m, i) => (
                    <span className="day-item" key={i}>
                      {m.title}
                    </span>
                  ))}
              </div>
            )}
            {dayEvents.some((e) => e.kind === "episode") && (
              <div className="day-group">
                <span className="day-kind" style={{ color: C_EPISODES }}>
                  Episodes
                </span>
                {groupEpisodes(dayEvents.filter((e) => e.kind === "episode")).map(
                  (g, i) => (
                    <span className="day-item" key={i}>
                      {g}
                    </span>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Weekday profile + decades */}
      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginBottom: 18 }}
      >
        <div className="panel" style={{ marginBottom: 0 }}>
          <h3>Weekday profile</h3>
          {stats.weekdays.map((w, i) => (
            <div className="hbar-row" key={i}>
              <span className="name">{WEEKDAYS[i]}</span>
              <span className="track">
                <span
                  className="bar"
                  style={{ width: `${((w.movies + w.episodes) / maxWeekday) * 100}%` }}
                />
              </span>
              <span className="val">{w.movies + w.episodes}</span>
            </div>
          ))}
        </div>
        <div className="panel" style={{ marginBottom: 0 }}>
          <h3>Movies by release decade</h3>
          {stats.decadeRows.map((d) => (
            <div className="hbar-row" key={d.label}>
              <span className="name">{d.label}</span>
              <span className="track">
                <span
                  className="bar"
                  style={{
                    width: `${(d.count / maxDecade) * 100}%`,
                    background: C_EPISODES,
                  }}
                />
              </span>
              <span className="val">{d.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Taste profile */}
      {(stats.genreCompletion.length > 0 ||
        stats.pace ||
        stats.abandon ||
        stats.runtimeTotal > 0) && (
        <div className="panel">
          <h3>Taste profile</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            {stats.genreCompletion.length > 0 && (
              <div>
                <h4 style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
                  Genres you actually finish
                </h4>
                {stats.genreCompletion.map((g) => (
                  <div className="hbar-row" key={g.name}>
                    <span className="name">{g.name}</span>
                    <span className="track">
                      <span className="bar" style={{ width: `${g.pct * 100}%` }} />
                    </span>
                    <span className="val">{Math.round(g.pct * 100)}%</span>
                  </div>
                ))}
                <p className="hint" style={{ marginTop: 8 }}>
                  Share of started shows you completed, per genre (min. 3 shows).
                </p>
              </div>
            )}
            <div>
              <h4 style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
                How you watch
              </h4>
              <ul className="fact-list">
                {stats.pace && (
                  <li>
                    On days you really watch TV, you average{" "}
                    <b>{stats.pace.avgPerDay.toFixed(1)} episodes</b> — your
                    biggest genuine session was <b>{stats.pace.realBinge} episodes</b>{" "}
                    in a day, across {stats.pace.activeDays.toLocaleString()} active days.
                  </li>
                )}
                {stats.abandon && (
                  <li>
                    You've stopped <b>{stats.abandon.count} shows</b>, usually
                    around <b>{Math.round(stats.abandon.avgPct * 100)}%</b> of
                    the way through — that's your patience threshold.
                  </li>
                )}
                {stats.runtimeTotal > 0 && (
                  <li>
                    Your TV time splits{" "}
                    <b>{Math.round((stats.runtimeSplit.short / stats.runtimeTotal) * 100)}%</b>{" "}
                    short episodes (≤25 min),{" "}
                    <b>{Math.round((stats.runtimeSplit.medium / stats.runtimeTotal) * 100)}%</b>{" "}
                    standard (26–45), and{" "}
                    <b>{Math.round((stats.runtimeSplit.long / stats.runtimeTotal) * 100)}%</b>{" "}
                    long-form (45+).
                  </li>
                )}
                {stats.rewatches > 0 && (
                  <li>
                    <b>{stats.rewatches}</b> rewatches logged — comfort viewing
                    is part of your diet.
                  </li>
                )}
                <li>
                  You complete <b>{stats.started ? Math.round((stats.completed / stats.started) * 100) : 0}%</b>{" "}
                  of the shows you start ({stats.completed}/{stats.started}).
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* You vs the world */}
      {stats.vsWorld && (
        <div className="panel">
          <h3>You vs the world</h3>
          <p className="hint" style={{ marginBottom: 12 }}>
            Across {stats.vsWorld.n} titles you rated: you average{" "}
            <b>{stats.vsWorld.avgMine.toFixed(1)}/10</b>, IMDb voters average{" "}
            <b>{stats.vsWorld.avgWorld.toFixed(1)}/10</b>.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
            <div>
              <h4 style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
                You loved these more than the world
              </h4>
              {stats.vsWorld.youLoved.map((g) => (
                <div
                  className="hbar-row"
                  key={g.title}
                  style={{ gridTemplateColumns: "1fr 90px" }}
                >
                  <span className="name" style={{ textAlign: "left" }} title={g.title}>
                    {g.title}
                  </span>
                  <span className="val">
                    {g.mine.toFixed(0)} vs {g.world.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
            <div>
              <h4 style={{ fontSize: 12.5, color: "var(--ink-muted)", marginBottom: 8 }}>
                The world loved these more
              </h4>
              {stats.vsWorld.worldLoved.map((g) => (
                <div
                  className="hbar-row"
                  key={g.title}
                  style={{ gridTemplateColumns: "1fr 90px" }}
                >
                  <span className="name" style={{ textAlign: "left" }} title={g.title}>
                    {g.title}
                  </span>
                  <span className="val">
                    {g.mine.toFixed(0)} vs {g.world.toFixed(1)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Most-watched + genres */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {stats.topShows.length > 0 && (
          <div className="panel" style={{ marginBottom: 0 }}>
            <h3>Most-watched shows</h3>
            {stats.topShows.map((s) => (
              <div className="hbar-row" key={s.name}>
                <span className="name" title={s.name}>
                  {s.name}
                </span>
                <span className="track">
                  <span
                    className="bar"
                    style={{ width: `${(s.count / stats.topShows[0].count) * 100}%` }}
                  />
                </span>
                <span className="val">{s.count}</span>
              </div>
            ))}
            <p className="hint" style={{ marginTop: 10 }}>
              Open a show and use “Hide from stats” to exclude it here.
            </p>
          </div>
        )}
        {stats.topGenres.length > 0 && (
          <div className="panel" style={{ marginBottom: 0 }}>
            <h3>Top genres</h3>
            {stats.topGenres.map((g) => (
              <div className="hbar-row" key={g.name}>
                <span className="name">{g.name}</span>
                <span className="track">
                  <span
                    className="bar"
                    style={{
                      width: `${(g.count / stats.topGenres[0].count) * 100}%`,
                      background: C_EPISODES,
                    }}
                  />
                </span>
                <span className="val">{g.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {!stats.hasMeta && (
        <p className="hint" style={{ marginTop: 14 }}>
          Genres and exact runtimes appear here once TMDB metadata has been fetched
          (add your API key in Settings).
        </p>
      )}

      {tip && (
        <div
          className="viz-tooltip"
          style={{ left: tip.x, top: tip.y }}
          dangerouslySetInnerHTML={{ __html: tip.html }}
        />
      )}
    </div>
  );
}

// "Breaking Bad S01E01, S01E02" style grouping for a day's episodes.
function groupEpisodes(eps) {
  const byShow = new Map();
  for (const e of eps) {
    if (!byShow.has(e.title)) byShow.set(e.title, []);
    byShow.get(e.title).push(e.code);
  }
  return [...byShow.entries()].map(
    ([title, codes]) =>
      `${title} ${codes.length > 3 ? `${codes[0]}–${codes[codes.length - 1]} (${codes.length} eps)` : codes.join(", ")}`
  );
}
