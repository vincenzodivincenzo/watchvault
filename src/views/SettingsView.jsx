import React, { useEffect, useState } from "react";
import { testKey } from "../tmdb.js";
import { testOmdbKey } from "../omdb.js";
import { exportBackup, getLibraryPath } from "../store.js";
import { detectBulkFlags, clearBulkFlags, countBulkFlags } from "../bulk.js";

const COUNTRIES = [
  ["IT", "Italy"], ["US", "United States"], ["GB", "United Kingdom"],
  ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["PT", "Portugal"],
  ["NL", "Netherlands"], ["CH", "Switzerland"], ["AT", "Austria"],
  ["BE", "Belgium"], ["IE", "Ireland"], ["SE", "Sweden"], ["NO", "Norway"],
  ["DK", "Denmark"], ["FI", "Finland"], ["CA", "Canada"], ["AU", "Australia"],
  ["BR", "Brazil"], ["JP", "Japan"],
];

export default function SettingsView({ lib, update, onImport, notify }) {
  const [key, setKey] = useState(lib.settings?.tmdbKey || "");
  const [keyState, setKeyState] = useState(null); // null | "testing" | "ok" | error string
  const [path, setPath] = useState("");

  useEffect(() => {
    getLibraryPath().then(setPath).catch(() => {});
  }, []);

  async function saveKey() {
    const trimmed = key.trim();
    if (!trimmed) {
      update((next) => (next.settings.tmdbKey = ""));
      setKeyState(null);
      return;
    }
    setKeyState("testing");
    try {
      await testKey(trimmed);
      update((next) => (next.settings.tmdbKey = trimmed));
      setKeyState("ok");
      notify("TMDB key saved — fetching metadata in the background");
    } catch (e) {
      setKeyState(`Key check failed: ${String(e).slice(0, 140)}`);
    }
  }

  const refreshable =
    lib.movies.filter((m) => m.metaFailed).length +
    lib.shows.filter((s) => s.metaFailed).length;

  return (
    <div className="settings">
      <div className="panel">
        <h3>Appearance</h3>
        <div className="row" style={{ gap: 8 }}>
          {[
            { id: "light", label: "☀️ Light" },
            { id: "dark", label: "🌙 Dark" },
            { id: "system", label: "💻 System" },
          ].map((t) => (
            <button
              key={t.id}
              className={`btn ${(lib.settings?.theme || "light") === t.id ? "primary" : ""}`}
              onClick={() => update((next) => (next.settings.theme = t.id))}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>TMDB connection</h3>
        <p>
          WatchVault uses The Movie Database (TMDB) for posters, descriptions,
          runtimes and search. Create a free account, then copy your{" "}
          <b>API key</b> (v3) or <b>Read Access Token</b> (v4) here.
        </p>
        <div className="row">
          <input
            type="password"
            placeholder="TMDB API key or read access token"
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setKeyState(null);
            }}
          />
          <button className="btn primary" onClick={saveKey} disabled={keyState === "testing"}>
            {keyState === "testing" ? "Checking…" : "Save"}
          </button>
        </div>
        {keyState === "ok" && <p className="ok" style={{ marginTop: 8 }}>✓ Key works. Metadata will fill in automatically.</p>}
        {keyState && keyState !== "ok" && keyState !== "testing" && (
          <p className="err" style={{ marginTop: 8 }}>{keyState}</p>
        )}
        <p className="hint">
          Get a key at themoviedb.org → Settings → API (choose “Developer”, any
          personal use). Your key is stored only in your local library file.
        </p>
        {refreshable > 0 && (
          <div style={{ marginTop: 10 }}>
            <button
              className="btn small"
              onClick={() =>
                update((next) => {
                  for (const m of next.movies) delete m.metaFailed;
                  for (const s of next.shows) delete s.metaFailed;
                })
              }
            >
              Retry {refreshable} items that failed metadata lookup
            </button>
          </div>
        )}
      </div>

      <OmdbPanel lib={lib} update={update} notify={notify} />

      <div className="panel">
        <h3>Streaming country</h3>
        <p>
          “Where to watch” availability on your To Watch list is shown for this
          country.
        </p>
        <select
          value={lib.settings?.country || "IT"}
          onChange={(e) => update((next) => (next.settings.country = e.target.value))}
        >
          {COUNTRIES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>

      <div className="panel">
        <h3>Your data</h3>
        <p>
          Everything lives in a single JSON file on your Mac — no cloud, no
          account. Back it up anywhere you like.
        </p>
        <p className="hint">Library file: {path}</p>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button
            className="btn"
            onClick={async () => {
              if (await exportBackup(lib)) notify("Backup exported");
            }}
          >
            ⬇︎ Export backup…
          </button>
          <button className="btn" onClick={onImport}>
            ⬆︎ Import TV Time export / backup…
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Import understands TV Time’s <code>tvtime-movies-*.json</code> and{" "}
          <code>tvtime-series-*.json</code> exports as well as WatchVault
          backups. Imports merge — nothing is ever un-watched.
        </p>
        {(lib.notInterested?.length || 0) > 0 && (
          <div style={{ marginTop: 12 }}>
            <p className="hint">
              Discover “not interested” list: {lib.notInterested.length}{" "}
              title{lib.notInterested.length === 1 ? "" : "s"} (
              {lib.notInterested
                .slice(-3)
                .map((d) => d.title)
                .join(", ")}
              {lib.notInterested.length > 3 ? "…" : ""})
            </p>
            <button
              className="btn small"
              style={{ marginTop: 6 }}
              onClick={() => {
                if (confirm("Clear the not-interested list? These titles may be recommended again."))
                  update((next) => (next.notInterested = []));
              }}
            >
              Clear not-interested list
            </button>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Data quality</h3>
        <p>
          Bulk-logged history (marking a whole series watched in one go, like a
          TV Time import) stays in your totals but is excluded from time-based
          charts, streaks and records — so analytics reflect real viewing.
        </p>
        <p className="hint">
          Currently flagged: {countBulkFlags(lib).toLocaleString()} watch events.
          New “Mark all” and whole-series logs are flagged automatically.
        </p>
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              let report;
              update((next) => {
                report = detectBulkFlags(next);
              });
              notify(
                `Flagged ${report.flaggedEps} episodes and ${report.flaggedMovies} movies across ${report.days} suspicious days`
              );
            }}
          >
            🔍 Detect bulk-logged history
          </button>
          <button
            className="btn"
            onClick={() => {
              if (!confirm("Clear all bulk flags? Time charts will count everything again."))
                return;
              let n;
              update((next) => {
                n = clearBulkFlags(next);
              });
              notify(`Cleared ${n} bulk flags`);
            }}
          >
            Clear flags
          </button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Detection flags days with more than 16 episodes, one show exceeding 12
          episodes in a day, or more than 4 movies in a day. Toggling an episode
          by hand always makes it a real event again.
        </p>
      </div>

      <div className="panel">
        <h3>About</h3>
        <p className="hint">
          Community ratings by OMDb (IMDb, Rotten Tomatoes, Metacritic).
          Streaming availability data by JustWatch via TMDB.
        </p>
        <p className="hint">
          WatchVault 1.0 — a local-first replacement for TV Time. Movie &amp; TV
          metadata provided by TMDB. This product uses the TMDB API but is not
          endorsed or certified by TMDB.
        </p>
      </div>
    </div>
  );
}

function OmdbPanel({ lib, update, notify }) {
  const [key, setKey] = useState(lib.settings?.omdbKey || "");
  const [state, setState] = useState(null); // null | "testing" | "ok" | error

  const rated =
    lib.movies.filter((m) => m.omdb).length + lib.shows.filter((s) => s.omdb).length;
  const failed =
    lib.movies.filter((m) => m.omdbFailed).length +
    lib.shows.filter((s) => s.omdbFailed).length;

  async function save() {
    const trimmed = key.trim();
    if (!trimmed) {
      update((next) => (next.settings.omdbKey = ""));
      setState(null);
      return;
    }
    setState("testing");
    try {
      await testOmdbKey(trimmed);
      update((next) => (next.settings.omdbKey = trimmed));
      setState("ok");
      notify("OMDb key saved — fetching community ratings in the background");
    } catch (e) {
      setState(`Key check failed: ${String(e).slice(0, 140)}`);
    }
  }

  return (
    <div className="panel">
      <h3>Community ratings (OMDb)</h3>
      <p>
        Adds IMDb, Rotten Tomatoes and Metacritic scores to every title. Get a
        free key (1,000 lookups/day) at omdbapi.com/apikey.aspx.
      </p>
      <div className="row">
        <input
          type="password"
          placeholder="OMDb API key"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setState(null);
          }}
        />
        <button className="btn primary" onClick={save} disabled={state === "testing"}>
          {state === "testing" ? "Checking…" : "Save"}
        </button>
      </div>
      {state === "ok" && (
        <p className="ok" style={{ marginTop: 8 }}>
          ✓ Key works. Ratings will fill in automatically.
        </p>
      )}
      {state && state !== "ok" && state !== "testing" && (
        <p className="err" style={{ marginTop: 8 }}>{state}</p>
      )}
      {rated > 0 && (
        <p className="hint">
          {rated} titles have community ratings
          {failed > 0 ? ` · ${failed} not found on OMDb` : ""}.
        </p>
      )}
    </div>
  );
}
