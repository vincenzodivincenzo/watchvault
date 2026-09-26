import React, { useEffect, useState } from "react";
import { Poster } from "../ui.jsx";
import { DetailCard, favoriteAction } from "../DetailCard.jsx";
import { movieDetails, tvDetails, img } from "../tmdb.js";
import { addMovieFromTmdb, addShowFromTmdb, markItemWatched } from "../libops.js";
import { findOwned } from "../catalog.js";

// The sheet for a catalogue result — the same description card the shelf uses,
// given add actions instead of edit actions.
//
// The moment a result is added it stops being a result, so this sheet does not
// close and congratulate you: it re-reads the library, finds the item that now
// exists, and hands its buttons the real thing. Favorite and the stars work
// before the title is yours (they are applied as it is added) and after it is
// (they patch the item). From the outside there is no seam, which is the point
// — a title looked up and a title owned are the same object at two moments.
export default function CatalogDetail({ entry, lib, update, notify, onClose }) {
  const owned = findOwned(lib, entry);
  return (
    <ScreenCatalogDetail
      entry={entry}
      owned={owned}
      lib={lib}
      update={update}
      notify={notify}
      onClose={onClose}
    />
  );
}

// Patch whichever list the item lives in, by uuid.
function patcher(update, kind, uuid) {
  const list = kind === "movie" ? "movies" : "shows";
  return (fn) =>
    update((next) => {
      const it = (next[list] || []).find((x) => x.uuid === uuid);
      if (it) fn(it);
    });
}

function ScreenCatalogDetail({ entry, owned, lib, update, notify, onClose }) {
  const key = lib.settings?.tmdbKey;
  const isMovie = entry.kind === "movie";
  const [det, setDet] = useState(null);
  const [rating, setRating] = useState(0);
  const [fav, setFav] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(null); // "watch" | "list" | "fav" | null
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let live = true;
    (isMovie ? movieDetails(key, entry.tmdbId) : tvDetails(key, entry.tmdbId))
      .then((d) => live && setDet(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [entry.tmdbId, isMovie, key]);

  // One add path, so every button applies the stars and the heart the same way.
  async function add({ watched = false, favorite = fav, stars = rating } = {}) {
    const { uuid, title } = isMovie
      ? await addMovieFromTmdb(update, key, entry.tmdbId)
      : await addShowFromTmdb(update, key, entry.tmdbId);
    const kind = isMovie ? "movie" : "show";
    if (watched) {
      markItemWatched(update, kind, uuid, {
        dateIso: new Date(`${date}T12:00:00`).toISOString(),
        rating: stars || null,
      });
    } else if (stars) {
      patcher(update, kind, uuid)((x) => (x.rating = stars));
    }
    if (favorite) patcher(update, kind, uuid)((x) => (x.isFavorite = true));
    return title;
  }

  async function run(mode, fn, done) {
    setBusy(mode);
    try {
      done(await fn());
    } catch (e) {
      notify(`Could not add: ${String(e).slice(0, 120)}`);
    } finally {
      setBusy(null);
    }
  }

  const ownedPatch = owned ? patcher(update, entry.kind, owned.uuid) : null;

  // Owned: the buttons drive the real item. Not owned yet: they describe what
  // will be saved, and pressing the heart saves it right away.
  const actions = owned
    ? [
        {
          id: "watched",
          label: owned.isWatched ? "✓ Watched" : "Mark watched",
          variant: owned.isWatched ? null : "primary",
          active: !!owned.isWatched,
          onClick: () =>
            ownedPatch((x) => {
              x.isWatched = !x.isWatched;
              x.watchedAt = x.isWatched ? new Date().toISOString() : null;
            }),
        },
        favoriteAction(owned.isFavorite, () =>
          ownedPatch((x) => (x.isFavorite = !x.isFavorite))
        ),
      ]
    : [
        {
          id: "watched",
          label: busy === "watch" ? "Logging…" : `✓ Add as watched${rating ? ` · ★ ${rating}` : ""}`,
          variant: "primary",
          disabled: !!busy,
          onClick: () =>
            run("watch", () => add({ watched: true }), (t) => {
              notify(
                `“${t}” logged as watched${rating ? ` · ★ ${rating}` : ""}${
                  isMovie ? "" : " (all aired episodes)"
                }`
              );
            }),
        },
        {
          id: "list",
          label: busy === "list" ? "Adding…" : "＋ Add to watchlist",
          disabled: !!busy,
          onClick: () =>
            run("list", () => add(), (t) => notify(`Added “${t}” to your watchlist`)),
        },
        favoriteAction(fav, () => {
          // Nothing to hold the flag on yet, so the heart adds the title.
          setFav(true);
          run("fav", () => add({ favorite: true }), (t) =>
            notify(`Added “${t}” to your library as a favorite`)
          );
        }, { disabled: !!busy }),
      ];

  const ratingCtl = owned
    ? { value: owned.rating || 0, onChange: (v) => ownedPatch((x) => (x.rating = v)) }
    : { value: rating, onChange: (v) => setRating(v || 0) };

  const facts = [
    entry.year,
    isMovie
      ? det?.runtime
        ? `${det.runtime} min`
        : null
      : det
        ? `${det.number_of_seasons} season${det.number_of_seasons === 1 ? "" : "s"} · ${det.number_of_episodes} episodes`
        : null,
    !isMovie ? det?.status : null,
    entry.votes ? `★ ${entry.votes.toFixed(1)} on TMDB` : null,
  ];

  return (
    <DetailCard
      onClose={onClose}
      title={entry.title}
      art={<Poster item={owned || entry} />}
      backdropUrl={entry.meta?.backdrop ? img(entry.meta.backdrop, "w780") : null}
      facts={facts}
      tags={(det?.genres || []).map((g) => g.name)}
      overview={entry.meta?.overview || det?.overview || "No description available."}
      aside={
        owned ? null : (
          <label className="detail-date">
            Watched on{" "}
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        )
      }
      actions={actions}
      rating={ratingCtl}
      hint={
        owned
          ? `Already in your library — it is on the ${isMovie ? "Movies" : "TV Shows"} shelf above.`
          : isMovie
            ? null
            : "“Add as watched” marks every aired episode on that date (kept out of time charts as logged history)."
      }
    />
  );
}
