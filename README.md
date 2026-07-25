# WatchVault

A local-first macOS app that replaces TV Time: track movies and TV shows,
per-episode watch history, ratings, favorites and stats — all stored in a
single JSON file on your Mac that no shutdown can take away.

Built with Tauri 2 + React. Metadata and search come from
[TMDB](https://www.themoviedb.org) (free API key required for posters,
descriptions and adding new titles — everything else works offline).

## Everyday use

- The app lives at `src-tauri/target/release/bundle/macos/WatchVault.app`
  (copy it to `/Applications` if you like).
- Your data lives in
  `~/Library/Application Support/com.vincenzo.watchvault/library.json`.
  Back that one file up and you can never lose your history.
- **Settings → TMDB connection**: paste a free API key from
  themoviedb.org → Settings → API. Posters/details then fill in
  automatically, and the “＋ Add” search starts working.
- **Settings → Export backup** writes a portable JSON snapshot; the same
  screen re-imports TV Time exports or WatchVault backups (imports merge,
  nothing is ever un-watched).
- In a show, **⟳ Sync episodes** pulls the latest episode list from TMDB;
  the TV Shows toolbar has **⟳ Check for new episodes** to refresh every
  running show at once. Cards then show **Ended / ✓ Completed / ● New
  episodes** badges.
- **To Watch** is the watchlist: separate movie and series sections, sorted
  by when you added them. One click logs a title as watched — date stamped
  automatically (editable), star rating right in the same dialog; for a
  series it marks every aired episode at once.
- **Discover** recommends movies and shows based on your favorites, ratings
  and recent watches (TMDB recommendations, aggregated locally). Click a
  card for the full description before adding.
- **Settings → Appearance** switches Light / Dark / System themes.
- **Stats** is a full analytics studio: records (streaks, biggest day, most
  active month, favorite weekday), a Watch activity chart by year / month /
  week with drill-down (click a year → its months; click a bar → that
  period's top show & genre), the clickable daily calendar, weekday profile,
  release-decade distribution, and — once OMDb ratings are in — a
  "You vs the world" comparison of your stars against IMDb voters.
- **Community ratings**: add a free OMDb key in Settings and every title
  gets IMDb / Rotten Tomatoes / Metacritic scores on its detail page, plus a
  "Community rating" sort in Movies.
- **Where to watch**: To Watch cards show streaming availability
  (Netflix, Prime, …) for the country set in Settings, via TMDB/JustWatch.
- **Stats** includes a clickable daily watch calendar — pick a year, click a
  day to see exactly what you watched. A show's detail page has “Hide from
  stats” to keep casual add-ons out of the charts.

## Development

```bash
npm install
npm run dev            # UI in a browser (localStorage, dev seed)
npx tauri dev          # full app in dev mode
npx tauri build        # produce WatchVault.app
node scripts/convert.mjs             # rebuild dev seed from ../tvtime-*.json
node scripts/convert.mjs --install   # seed the app's library (won't overwrite)
```

## Data model

`library.json`: `{ version, settings: { tmdbKey }, movies: [...], shows: [...] }`.
Movies keep `imdb`/`tvdb` ids from TV Time plus a `meta` block cached from
TMDB. Shows contain `seasons[].episodes[]` with per-episode
`isWatched`/`watchedAt`/`rewatchCount`.
