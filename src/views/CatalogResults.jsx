import React, { useState } from "react";
import { Poster } from "../ui.jsx";
import { useCatalogSearch, ownsResult, CATALOG_SOURCE } from "../catalog.js";
import CatalogDetail from "./CatalogDetail.jsx";

// Everything the shelf's catalogue knows that the shelf itself does not.
//
// Rendered directly under the shelf grid, in the shelf's own card language, so
// the boundary between "mine" and "not mine yet" is one heading rule rather
// than a different screen. Silent until the filter box holds a real query.
//
// The cards carry no add buttons of their own. An earlier version put a "＋"
// on the poster, which made a catalogue card visibly a different kind of thing from a shelf card — the
// opposite of the point. Clicking any card, here or above, opens the same
// description card, and the actions live there.
export default function CatalogResults({ kind, query, lib, update, notify }) {
  const tmdbKey = lib.settings?.tmdbKey;
  const { term, results, busy, error, ready } = useCatalogSearch(kind, query, { tmdbKey });
  const [open, setOpen] = useState(null);

  // A query with no TMDB key behind it is the one case worth saying out loud:
  // the shelf looks broken otherwise.
  if (!ready) {
    if (!tmdbKey && (query || "").trim().length >= 2) {
      return (
        <p className="catalog-note">
          Add a TMDB API key in Settings to search beyond your library.
        </p>
      );
    }
    return null;
  }

  const fresh = results.filter((e) => !ownsResult(lib, e));
  const source = CATALOG_SOURCE[kind];

  return (
    <section className="catalog">
      <div className="catalog-head">
        <h2>Not in your library</h2>
        <span className="catalog-src">
          {busy ? `Searching ${source}…` : `${fresh.length} from ${source}`}
        </span>
      </div>

      {error && <p className="catalog-note">Search failed: {error}</p>}

      {!busy && !error && fresh.length === 0 && (
        <p className="catalog-note">
          {results.length
            ? `Everything ${source} found for “${term}” is already yours.`
            : `Nothing on ${source} for “${term}”.`}
        </p>
      )}

      <div className="poster-grid">
        {fresh.map((e) => (
          <div className="card" key={e.id} onClick={() => setOpen(e)}>
            <Poster item={e} />
            <div className="info">
              <div className="title">{e.title}</div>
              <div className="sub">
                <span>{e.year || "—"}</span>
                {e.votes ? <span>★ {e.votes.toFixed(1)}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <CatalogDetail
          entry={open}
          lib={lib}
          update={update}
          notify={notify}
          onClose={() => setOpen(null)}
        />
      )}
    </section>
  );
}
