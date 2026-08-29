import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyLibrary, loadLibrary, saveLibrary, pickImportFiles, isTauri } from "./store.js";
import { importTvTimeFiles } from "./importer.js";
import { enrichLibrary, needsEnrichment } from "./enrich.js";
import { enrichOmdb, needsOmdb } from "./omdb.js";
import MoviesView from "./views/MoviesView.jsx";
import ShowsView from "./views/ShowsView.jsx";
import StatsView from "./views/StatsView.jsx";
import SettingsView from "./views/SettingsView.jsx";
import SearchView from "./views/SearchView.jsx";
import DiscoverView from "./views/DiscoverView.jsx";
import WatchlistView from "./views/WatchlistView.jsx";
import BooksView from "./views/BooksView.jsx";
import { VaultMark, Icon, nextEpisode, epCode } from "./ui.jsx";
import CommandPalette from "./CommandPalette.jsx";
import { enrichBooks, needsBookMeta } from "./books.js";

const NAV = [
  { id: "discover", label: "Home", icon: "home" },
  { id: "search", label: "Search", icon: "search" },
  { id: "movies", label: "Movies", icon: "film" },
  { id: "books", label: "Books", icon: "book" },
  { id: "shows", label: "TV Shows", icon: "tv" },
  { id: "watchlist", label: "To Watch", icon: "bookmark" },
  { id: "stats", label: "Stats", icon: "chart" },
  { id: "settings", label: "Settings", icon: "sliders" },
];

export default function App() {
  const [lib, setLib] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [viewRaw, setViewRaw] = useState("discover"); // Discover is the home page
  const view = viewRaw;
  const [query, setQuery] = useState("");

  // The filter box is shared by every shelf, so a query typed on Movies would
  // otherwise carry over and silently empty the next one.
  const setView = useCallback((next) => {
    setViewRaw((prev) => {
      if (prev !== next) setQuery("");
      return next;
    });
  }, []);
  const [toast, setToast] = useState(null);
  const [enriching, setEnriching] = useState(0);
  const enrichRun = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    loadLibrary()
      .then((l) => setLib(l))
      .catch((e) => {
        console.error("load failed", e);
        setLib(null);
      })
      .finally(() => setLoaded(true));
  }, []);

  // Persist on every library change (skip initial load).
  const dirty = useRef(false);
  useEffect(() => {
    if (!lib) return;
    if (!dirty.current) {
      dirty.current = true;
      return;
    }
    const t = setTimeout(() => {
      saveLibrary(lib).catch((e) => notify(`Save failed: ${e}`));
    }, 400);
    return () => clearTimeout(t);
  }, [lib]);

  // Apply the theme setting (light | dark | system) to the document root.
  const theme = lib?.settings?.theme || "light";
  useEffect(() => {
    const root = document.documentElement;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      root.dataset.theme = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
    };
    apply();
    if (theme === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [theme]);

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const update = useCallback((fn) => {
    setLib((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const patchItem = useCallback((kind, uuid, patch) => {
    setLib((prev) => {
      const next = { ...prev };
      const listName = kind === "movie" ? "movies" : "shows";
      next[listName] = prev[listName].map((x) =>
        x.uuid === uuid ? { ...x, ...patch } : x
      );
      return next;
    });
  }, []);

  // Kick off metadata enrichment whenever there are un-enriched items and a key.
  const tmdbKey = lib?.settings?.tmdbKey || "";
  const pendingMeta = lib ? needsEnrichment(lib) : 0;
  useEffect(() => {
    if (!lib || !tmdbKey || pendingMeta === 0 || enrichRun.current) return;
    const controller = new AbortController();
    enrichRun.current = controller;
    setEnriching(pendingMeta);
    enrichLibrary(lib, tmdbKey, {
      signal: controller.signal,
      onItem: patchItem,
      onProgress: (n) => setEnriching(n),
    })
      .catch((e) => notify(`TMDB error: ${String(e).slice(0, 120)}`))
      .finally(() => {
        if (enrichRun.current === controller) enrichRun.current = null;
        setEnriching(0);
      });
    return () => {
      controller.abort();
      if (enrichRun.current === controller) enrichRun.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbKey, pendingMeta === 0, lib === null]);

  // Open Library covers and blurbs for books. No key needed, so unlike the
  // TMDB and OMDb passes this one just runs.
  const pendingBooks = lib?.books ? needsBookMeta(lib.books) : 0;
  const bookRun = useRef(null);
  const patchBook = useCallback((uuid, patch) => {
    setLib((prev) => ({
      ...prev,
      books: (prev.books || []).map((b) =>
        b.uuid === uuid ? { ...b, ...patch } : b
      ),
    }));
  }, []);
  useEffect(() => {
    if (!lib?.books?.length || pendingBooks === 0 || bookRun.current) return;
    const controller = new AbortController();
    bookRun.current = controller;
    enrichBooks(lib.books, {
      signal: controller.signal,
      onItem: patchBook,
    })
      .catch((e) => notify(`Open Library error: ${String(e).slice(0, 120)}`))
      .finally(() => {
        if (bookRun.current === controller) bookRun.current = null;
      });
    return () => {
      controller.abort();
      if (bookRun.current === controller) bookRun.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBooks === 0, lib === null]);

  // Community ratings (OMDb) enrichment — runs quietly once a key is set.
  const omdbKey = lib?.settings?.omdbKey || "";
  const pendingOmdb = lib ? needsOmdb(lib) : 0;
  const omdbRun = useRef(null);
  useEffect(() => {
    if (!lib || !omdbKey || pendingOmdb === 0 || omdbRun.current) return;
    const controller = new AbortController();
    omdbRun.current = controller;
    enrichOmdb(lib, omdbKey, {
      signal: controller.signal,
      onItem: patchItem,
    })
      .catch((e) => notify(`OMDb error: ${String(e).slice(0, 120)}`))
      .finally(() => {
        if (omdbRun.current === controller) omdbRun.current = null;
      });
    return () => {
      controller.abort();
      if (omdbRun.current === controller) omdbRun.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omdbKey, pendingOmdb === 0, lib === null]);

  // Home-feed cards jump straight into a show's episode list.
  const [pendingShow, setPendingShow] = useState(null);
  const openShowFromHome = useCallback((uuid) => {
    setPendingShow(uuid);
    setView("shows");
  }, []);

  // The palette jumps straight to a film's detail page too.
  const [pendingMovie, setPendingMovie] = useState(null);
  const openMovieFromPalette = useCallback((uuid) => {
    setPendingMovie(uuid);
    setView("movies");
  }, []);

  const [pendingBook, setPendingBook] = useState(null);
  const openBookFromPalette = useCallback((uuid) => {
    setPendingBook(uuid);
    setView("books");
  }, []);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [bookSearchOpen, setBookSearchOpen] = useState(false);
  const openBookSearch = useCallback(() => {
    setView("books");
    setBookSearchOpen(true);
  }, [setView]);

  // Log the next aired episode of a show without opening anything.
  const markNextEpisode = useCallback(
    (uuid) => {
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
    },
    [update, notify]
  );

  const goToSearch = useCallback(() => {
    setView("search");
    setTimeout(() => window.dispatchEvent(new Event("wv-focus-search")), 60);
  }, []);

  // ⌘K opens the palette. ⌘F keeps its narrower old meaning, the TMDB search
  // page, because that is muscle memory for adding a title.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (e.key === "f") {
        e.preventDefault();
        goToSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goToSearch]);

  async function handleImport() {
    const files = await pickImportFiles();
    if (!files.length) return;
    const base = lib || emptyLibrary();
    const { library, report } = importTvTimeFiles(files, structuredClone(base));
    setLib(library);
    dirty.current = true;
    const bits = [];
    if (report.moviesAdded) bits.push(`${report.moviesAdded} movies added`);
    if (report.showsAdded) bits.push(`${report.showsAdded} shows added`);
    if (report.booksAdded) bits.push(`${report.booksAdded} books added`);
    if (report.moviesMerged || report.showsMerged || report.booksMerged)
      bits.push(
        `${report.moviesMerged + report.showsMerged + (report.booksMerged || 0)} merged`
      );
    for (const s of report.skippedFiles) bits.push(s);
    notify(bits.length ? `Import: ${bits.join(", ")}` : "Nothing imported");
  }

  async function loadDevSeed() {
    const res = await fetch("/dev-seed.json");
    const seed = await res.json();
    setLib(seed);
    dirty.current = true;
    notify("Dev seed loaded");
  }

  if (!loaded) return null;

  if (!lib) {
    return (
      <div className="welcome">
        <VaultMark size={76} />
        <h1>WatchVault</h1>
        <p>
          Your movies and TV shows, stored locally on your Mac — forever. Start
          by importing your TV Time export files (movies and series JSON).
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" onClick={handleImport}>
            Import TV Time export…
          </button>
          <button
            className="btn"
            onClick={() => {
              setLib(emptyLibrary());
              dirty.current = true;
            }}
          >
            Start empty
          </button>
          {!isTauri() && import.meta.env.DEV && (
            <button className="btn" onClick={loadDevSeed}>
              Load dev seed
            </button>
          )}
        </div>
        {toast && <div className="toast">{toast}</div>}
      </div>
    );
  }

  const counts = {
    movies: lib.movies.length,
    shows: lib.shows.length,
    books: (lib.books || []).length,
    watchlist:
      lib.movies.filter((m) => !m.isWatched).length +
      lib.shows.filter(
        (s) =>
          s.status !== "stopped" &&
          !s.seasons.some((se) => se.episodes.some((e) => e.isWatched))
      ).length,
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <VaultMark size={28} /> WatchVault
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            className={`nav-item ${view === n.id ? "active" : ""}`}
            onClick={() => setView(n.id)}
          >
            <span className="icon">
              <Icon name={n.icon} />
            </span>
            {n.label}
            {counts[n.id] != null && <span className="count">{counts[n.id]}</span>}
          </button>
        ))}
        <div className="spacer" />
        {enriching > 0 && (
          <div className="enrich-status">
            Fetching TMDB metadata…
            <br />
            {enriching} items left
          </div>
        )}
        {!tmdbKey && pendingMeta > 0 && (
          <div className="enrich-status">
            Add a TMDB API key in Settings to fetch posters &amp; details.
          </div>
        )}
      </aside>

      <main className="main">
        {/* Native titlebar handles move/resize; the toolbar doubles as a
            drag surface, Safari-style. */}
        <div className="topbar" data-tauri-drag-region="">
          <h1 data-tauri-drag-region="">{NAV.find((n) => n.id === view)?.label}</h1>
          {(view === "movies" ||
            view === "shows" ||
            view === "books" ||
            view === "watchlist") && (
            <>
              <input
                className="search"
                placeholder={`Filter ${view}…`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {/* Each shelf adds from its own catalogue: TMDB for screen,
                  Open Library for books. Neither needs a key. */}
              {view === "books" ? (
                <button
                  className="btn primary"
                  onClick={() => setBookSearchOpen(true)}
                  title="Search Open Library"
                >
                  ＋ Add
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={goToSearch}
                  title={tmdbKey ? "Search TMDB (⌘K)" : "Requires a TMDB key (Settings)"}
                >
                  ＋ Add
                </button>
              )}
            </>
          )}
        </div>
        <div className="content">
          {view === "search" && (
            <SearchView lib={lib} update={update} notify={notify} />
          )}
          {view === "movies" && (
            <MoviesView
              lib={lib}
              query={query}
              update={update}
              pendingOpen={pendingMovie}
              onPendingConsumed={() => setPendingMovie(null)}
            />
          )}
          {view === "books" && (
            <BooksView
              lib={lib}
              query={query}
              update={update}
              notify={notify}
              pendingOpen={pendingBook}
              onPendingConsumed={() => setPendingBook(null)}
              searchOpen={bookSearchOpen}
              onSearchClose={() => setBookSearchOpen(false)}
            />
          )}
          {view === "shows" && (
            <ShowsView
              lib={lib}
              query={query}
              update={update}
              notify={notify}
              pendingOpen={pendingShow}
              onPendingConsumed={() => setPendingShow(null)}
            />
          )}
          {view === "watchlist" && (
            <WatchlistView lib={lib} query={query} update={update} notify={notify} />
          )}
          {view === "discover" && (
            <DiscoverView
              lib={lib}
              update={update}
              notify={notify}
              onOpenShow={openShowFromHome}
            />
          )}
          {view === "stats" && <StatsView lib={lib} />}
          {view === "settings" && (
            <SettingsView
              lib={lib}
              update={update}
              onImport={handleImport}
              notify={notify}
            />
          )}
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        lib={lib}
        setView={setView}
        openShow={openShowFromHome}
        openMovie={openMovieFromPalette}
        openBook={openBookFromPalette}
        markNext={markNextEpisode}
        onSearchTmdb={goToSearch}
        onSearchBooks={openBookSearch}
      />

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
