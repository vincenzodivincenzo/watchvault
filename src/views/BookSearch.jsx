import React, { useEffect, useRef, useState } from "react";
import { Modal } from "../ui.jsx";
import {
  searchBooks,
  bookFromSearch,
  alreadyOnShelf,
  coverUrl,
} from "../books.js";

// Search every book Open Library knows, not just the shelf.
//
// Open Library returns a work's canonical title, which for a translated work
// is the original: Dostoevsky comes back in Cyrillic. Filtering by language
// does not fix that and does exclude every non-English book, so the author and
// year are shown alongside instead and the title is left honest.
export default function BookSearch({ books, onAdd, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [state, setState] = useState("idle"); // idle | searching | done | error
  const [error, setError] = useState(null);
  const runRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setState("idle");
      return;
    }
    // Debounced so typing a title is one request, not one per keystroke.
    const t = setTimeout(async () => {
      runRef.current?.abort();
      const controller = new AbortController();
      runRef.current = controller;
      setState("searching");
      setError(null);
      try {
        const r = await searchBooks(term, { signal: controller.signal });
        setResults(r);
        setState("done");
      } catch (e) {
        if (e.name === "AbortError") return;
        setError(String(e).slice(0, 120));
        setState("error");
      }
    }, 320);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => () => runRef.current?.abort(), []);

  return (
    <Modal onClose={onClose} title="Add a book" className="booksearch">
      <div className="bs-head">
        <h2>Add a book</h2>
        <input
          className="search bs-input"
          autoFocus
          placeholder="Title, author, or ISBN…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="hint">
          Searches Open Library. Titles are the work’s original, so a
          translated book may appear in its own language.
        </p>
      </div>

      <div className="bs-results">
        {state === "searching" && <p className="hint">Searching…</p>}
        {state === "error" && <p className="hint">Search failed: {error}</p>}
        {state === "done" && results.length === 0 && (
          <p className="hint">Nothing found for “{q.trim()}”.</p>
        )}
        {results.map((r) => {
          const owned = alreadyOnShelf(books, r);
          const cover = coverUrl({ meta: { coverId: r.coverId }, isbn: r.isbn }, "S");
          return (
            <div className="bs-row" key={r.workKey || `${r.title}-${r.year}`}>
              <div className="bs-cover">
                {cover ? (
                  <img src={cover} alt="" loading="lazy" />
                ) : (
                  <span className="bs-nocover" />
                )}
              </div>
              <div className="bs-meta">
                <div className="bs-title">{r.title}</div>
                <div className="bs-sub">
                  {[
                    r.author,
                    r.year,
                    r.pages ? `${r.pages} pages` : null,
                    r.editions > 1 ? `${r.editions} editions` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              {owned ? (
                <span className="bs-owned">On your shelf</span>
              ) : (
                <div className="bs-actions">
                  <button
                    className="btn small"
                    onClick={() => onAdd(bookFromSearch(r, { status: "to-read" }))}
                  >
                    To read
                  </button>
                  <button
                    className="btn small primary"
                    onClick={() => onAdd(bookFromSearch(r, { status: "read" }))}
                  >
                    Read
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
