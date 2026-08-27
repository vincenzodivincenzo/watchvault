import React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { img } from "./tmdb.js";

// The in-app brand mark — the same vault-dial/film-reel as the macOS icon.
export function VaultMark({ size = 26 }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2b2420" />
          <stop offset="1" stopColor="#141210" />
        </linearGradient>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0aa3e" />
          <stop offset="1" stopColor="#cc7f0d" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="230" fill={`url(#${id}b)`} />
      <circle cx="512" cy="512" r="252" fill="none" stroke={`url(#${id}a)`} strokeWidth="46" />
      <g stroke={`url(#${id}a)`} strokeWidth="34" strokeLinecap="round">
        <line x1="512" y1="176" x2="512" y2="236" />
        <line x1="512" y1="788" x2="512" y2="848" />
        <line x1="176" y1="512" x2="236" y2="512" />
        <line x1="788" y1="512" x2="848" y2="512" />
        <line x1="274.6" y1="274.6" x2="317" y2="317" />
        <line x1="707" y1="707" x2="749.4" y2="749.4" />
        <line x1="749.4" y1="274.6" x2="707" y2="317" />
        <line x1="317" y1="707" x2="274.6" y2="749.4" />
      </g>
      <g fill={`url(#${id}a)`}>
        <circle cx="512" cy="400" r="52" />
        <circle cx="618.5" cy="477.4" r="52" />
        <circle cx="577.8" cy="602.6" r="52" />
        <circle cx="446.2" cy="602.6" r="52" />
        <circle cx="405.5" cy="477.4" r="52" />
      </g>
      <circle cx="512" cy="512" r="40" fill={`url(#${id}a)`} />
    </svg>
  );
}

// Minimal stroke icons for navigation — one voice instead of emoji.
const ICON_PATHS = {
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 2l4 5 4-5" />
    </>
  ),
  bookmark: <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4.5L6 21V4a1 1 0 0 1 1-1z" />,
  sparkles: (
    <>
      <path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3z" />
      <path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20v-10M17 20v-4" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" fill="var(--surface)" />
      <circle cx="15" cy="12" r="2.2" fill="var(--surface)" />
      <circle cx="8" cy="17" r="2.2" fill="var(--surface)" />
    </>
  ),
};

export function Icon({ name, size = 17 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] || null}
    </svg>
  );
}

// Deterministic hue per title so fallback posters vary pleasantly.
function hueFor(title) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return h;
}

export function Poster({ item, size = "w342", badge }) {
  const poster = item.meta?.poster;
  const hue = hueFor(item.title);
  return (
    <div className="poster">
      {poster ? (
        <img src={img(poster, size)} alt={item.title} loading="lazy" />
      ) : (
        <div
          className="fallback"
          style={{
            background: `linear-gradient(160deg, hsl(${hue} 30% 24%), hsl(${(hue + 40) % 360} 32% 14%))`,
          }}
        >
          <span>{item.title}</span>
          {item.year ? <span className="year">{item.year}</span> : null}
        </div>
      )}
      {badge}
      {item.isFavorite ? <span className="badge fav">❤️</span> : null}
    </div>
  );
}

export function movieBadge(m) {
  return m.isWatched ? <span className="badge watched">✓ Watched</span> : null;
}

// Status buckets for a show, combining local progress with TMDB status.
export function showState(show) {
  const { watched, total, airedUnwatched } = showProgress(show);
  const ended = /ended|canceled/i.test(show.meta?.statusText || "");
  const complete = total > 0 && watched >= total;
  if (complete && ended) return "completed";
  if (complete) return "uptodate";
  if (ended && watched === 0) return "notstarted-ended";
  if (watched === 0) return "notstarted";
  if (airedUnwatched > 0 && watched / total >= 0.85) return "newepisodes";
  return "watching";
}

export function showBadge(show) {
  const ended = /ended|canceled/i.test(show.meta?.statusText || "");
  const st = showState(show);
  const state =
    st === "completed" ? (
      <span className="badge watched">✓ Completed</span>
    ) : st === "uptodate" ? (
      <span className="badge watched">✓ Up to date</span>
    ) : st === "newepisodes" ? (
      <span className="badge new">● New episodes</span>
    ) : null;
  return (
    <>
      {state}
      {/* Solid tag on the bottom-right so ended shows are visible in every state. */}
      {ended && <span className="badge ended">ENDED</span>}
    </>
  );
}

// Canonical = a real numbered episode. Specials seasons (S0) and episodes
// flagged as specials (podcasts, snippets, recaps) stay visible in the
// episode list but never drive progress, badges, feeds or the watchlist.
export const isCanonSeason = (se) => !se.isSpecials && se.number !== 0;
export const isCanonEpisode = (se, e) => isCanonSeason(se) && !e.special;

// Aired = a past air date — or a legacy TV Time episode (no TMDB id), which
// carries no dates but definitely aired. TMDB-synced episodes without an air
// date are announced-but-unaired placeholders and must not count.
export const isAiredEpisode = (e) => {
  if (e.airDate) return e.airDate <= new Date().toISOString().slice(0, 10);
  return !e.tmdb;
};

export function showProgress(show) {
  let watched = 0;
  let total = 0;
  let airedUnwatched = 0;
  for (const se of show.seasons) {
    for (const e of se.episodes) {
      if (!isCanonEpisode(se, e)) continue;
      // Unaired (future or announced-with-no-date) episodes don't count.
      if (!isAiredEpisode(e)) continue;
      total++;
      if (e.isWatched) watched++;
      else airedUnwatched++;
    }
  }
  return { watched, total, airedUnwatched };
}

export function Progress({ value, max }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="progress">
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stars({ value, onChange }) {
  return (
    <span className="stars" title="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={value >= n ? "on" : ""}
          onClick={(e) => {
            e.stopPropagation();
            onChange(value === n ? null : n);
          }}
        >
          ★
        </button>
      ))}
    </span>
  );
}

// Radix owns the behaviour; styles.css still owns every pixel. The hand-rolled
// version handled Escape and click-outside and nothing else: no focus trap, no
// focus restore on close, no role, no aria-modal, no inert background, no
// scroll lock. Those are the parts that are tedious to write and easy to omit
// silently, which is exactly why they were omitted.
//
// `title` is required for an accessible dialog. It is rendered visually hidden
// because every one of these modals already shows the title in its own layout.
export function Modal({ onClose, children, className = "", title }) {
  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="overlay">
          <DialogPrimitive.Content
            className={`modal ${className}`}
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              {title || "Details"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close className="close" aria-label="Close">
              ✕
            </DialogPrimitive.Close>
            {children}
          </DialogPrimitive.Content>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// Community scores row (IMDb / Rotten Tomatoes / Metacritic from OMDb).
export function CommunityRatings({ omdb }) {
  if (!omdb || (!omdb.imdb && !omdb.rt && !omdb.mc)) return null;
  return (
    <div className="community" title={omdb.votes ? `${omdb.votes} IMDb votes` : ""}>
      {omdb.imdb ? (
        <span>
          <b>IMDb</b> {omdb.imdb.toFixed(1)}
        </span>
      ) : null}
      {omdb.rt ? (
        <span>
          <b>🍅</b> {omdb.rt}%
        </span>
      ) : null}
      {omdb.mc ? (
        <span>
          <b>MC</b> {omdb.mc}
        </span>
      ) : null}
    </div>
  );
}

// Stats bucket watches by the first ten characters of the raw ISO string
// (see bulk.js), so a date must be stored as the exact calendar day the user
// picked. Rebuilding a Date from "YYYY-MM-DD" and calling toISOString() shifts
// that day by one in any timezone behind UTC, which would silently move
// watches between months in the charts. Keep the original time of day when
// there is one, and otherwise pin to midday so nothing can drift.
// The next aired, canonical, unwatched episode of a show. Shared by Home and
// the command palette so "next" can never mean two different things.
export function nextEpisode(s) {
  const seasons = [...s.seasons].sort((a, b) => a.number - b.number);
  for (const se of seasons)
    for (const e of [...se.episodes].sort((a, b) => a.number - b.number))
      if (isCanonEpisode(se, e) && isAiredEpisode(e) && !e.isWatched)
        return { season: se.number, episode: e.number, name: e.name };
  return null;
}

export function epCode(next) {
  return `S${String(next.season).padStart(2, "0")}E${String(next.episode).padStart(2, "0")}`;
}

export function isoOnDay(day, prevIso) {
  const time = prevIso && prevIso.length > 10 ? prevIso.slice(10) : "T12:00:00.000Z";
  return `${day}${time}`;
}

// An inline, editable watch date. At rest it is the same "Aug 1, 2026" text
// the row always showed; a native date input only replaces it while editing,
// because the input renders in the OS locale format (01/08/2026) and that is
// not how dates read anywhere else in the app.
export function WatchDate({ iso, onChange, label = "Date watched" }) {
  const [editing, setEditing] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (!editing) {
    return (
      <button
        className="watch-date"
        title={`${label} — click to change`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {fmtDate(iso)}
      </button>
    );
  }

  return (
    <input
      className="watch-date editing"
      type="date"
      autoFocus
      defaultValue={iso ? iso.slice(0, 10) : ""}
      max={today}
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.showPicker?.()}
      onBlur={() => setEditing(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation(); // don't let Escape close the dialog too
          setEditing(false);
        }
      }}
      onChange={(e) => {
        if (e.target.value) {
          onChange(isoOnDay(e.target.value, iso));
          setEditing(false);
        }
      }}
    />
  );
}

export function fmtDate(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
