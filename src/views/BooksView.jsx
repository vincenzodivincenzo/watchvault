import React, { useEffect, useMemo, useState } from "react";
import { Modal, Stars, WatchDate, fmtDate } from "../ui.jsx";
import { Book } from "../objects.jsx";
import { coverUrl } from "../books.js";
import BookSearch from "./BookSearch.jsx";

const FILTERS = [
  ["all", "All"],
  ["reading", "Reading"],
  ["read", "Read"],
  ["to-read", "To read"],
  ["abandoned", "Abandoned"],
  ["favorites", "Favorites"],
];

const SORTS = [
  { id: "added_desc", label: "Recently added" },
  { id: "read_desc", label: "Recently read" },
  { id: "title", label: "Title A–Z" },
  { id: "author", label: "Author A–Z" },
  { id: "pages_desc", label: "Longest first" },
  { id: "rating_desc", label: "Highest rated" },
];

function matches(b, filter) {
  if (filter === "all") return true;
  if (filter === "favorites") return b.isFavorite;
  return b.status === filter;
}

export default function BooksView({
  lib,
  query,
  update,
  notify,
  pendingOpen,
  onPendingConsumed,
  searchOpen,
  onSearchClose,
}) {
  const [filter, setFilter] = useState("reading");
  const [sort, setSort] = useState("added_desc");
  const [openUuid, setOpenUuid] = useState(null);

  // The command palette can jump straight to a book.
  useEffect(() => {
    if (pendingOpen) {
      setOpenUuid(pendingOpen);
      onPendingConsumed?.();
    }
  }, [pendingOpen, onPendingConsumed]);

  const books = lib.books || [];

  const patch = (uuid, fn) =>
    update((next) => {
      const b = (next.books || []).find((x) => x.uuid === uuid);
      if (b) fn(b);
    });

  const counts = useMemo(() => {
    const c = {};
    for (const [id] of FILTERS) c[id] = books.filter((b) => matches(b, id)).length;
    return c;
  }, [books]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = books.filter(
      (b) =>
        matches(b, filter) &&
        (!q ||
          b.title.toLowerCase().includes(q) ||
          (b.author || "").toLowerCase().includes(q))
    );
    const by = {
      added_desc: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
      read_desc: (a, b) => (b.watchedAt || "").localeCompare(a.watchedAt || ""),
      title: (a, b) => a.title.localeCompare(b.title),
      author: (a, b) => (a.author || "").localeCompare(b.author || ""),
      pages_desc: (a, b) => (b.pages || 0) - (a.pages || 0),
      rating_desc: (a, b) => (b.rating || 0) - (a.rating || 0),
    };
    return [...list].sort(by[sort] || by.added_desc);
  }, [books, filter, sort, query]);

  const open = openUuid ? books.find((b) => b.uuid === openUuid) : null;

  const addBook = (book) => {
    update((next) => {
      if (!next.books) next.books = [];
      next.books.push(book);
    });
    notify?.(
      `“${book.title}” added${book.status === "read" ? " as read" : " to your reading list"}`
    );
  };

  const searchModal = searchOpen ? (
    <BookSearch books={books} onAdd={addBook} onClose={onSearchClose} />
  ) : null;

  if (!books.length) {
    return (
      <>
        <div className="empty-note">
          <h3>No books yet</h3>
          <p>
            ＋ Add searches Open Library for any book. To bring your whole
            history across at once, Settings → Import Goodreads CSV takes a
            Goodreads export with shelves, ratings, reviews and read dates.
          </p>
        </div>
        {searchModal}
      </>
    );
  }

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              className={`chip ${filter === id ? "on" : ""}`}
              onClick={() => setFilter(id)}
            >
              {label} <span className="chip-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <label className="sortwrap">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {shown.length === 0 && (
        <p className="empty-filter">
          No books match that filter.
        </p>
      )}
      <div className="obj-shelf">
        {shown.map((b) => (
          <Book key={b.uuid} book={b} onClick={() => setOpenUuid(b.uuid)} />
        ))}
      </div>

      {open && (
        <BookDetail
          book={open}
          patch={patch}
          onClose={() => setOpenUuid(null)}
        />
      )}
      {searchModal}
    </>
  );
}

// Goodreads stores reviews as HTML fragments. Render them as text rather than
// injecting markup: the content is the user's own, but there is no reason for a
// local archive to evaluate stored HTML.
function reviewText(html) {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function BookDetail({ book, patch, onClose }) {
  const cover = coverUrl(book, "L");
  const set = (fn) => patch(book.uuid, fn);

  return (
    <Modal onClose={onClose} title={book.title}>
      <div className="body">
        <div className="poster-col">
          <Book book={book} size="L" caption={false} />
        </div>
        <div className="meta-col">
          <h2>{book.title}</h2>
          <div className="subline">
            {[
              book.author,
              book.year,
              book.pages ? `${book.pages} pages` : null,
              book.status === "read" ? (
                <React.Fragment key="read">
                  Read{" "}
                  <WatchDate
                    iso={book.watchedAt}
                    label="Date read"
                    onChange={(iso) => set((b) => (b.watchedAt = iso))}
                  />
                </React.Fragment>
              ) : null,
              book.rewatchCount ? `${book.rewatchCount + 1} reads` : null,
            ]
              .filter(Boolean)
              .map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " · "}
                  {part}
                </React.Fragment>
              ))}
          </div>

          {book.tags?.length ? (
            <div className="genres">
              {book.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          ) : null}

          {book.meta?.blurb && <p className="overview">{book.meta.blurb}</p>}

          <div className="actions">
            {["reading", "read", "to-read", "abandoned"].map((s) => (
              <button
                key={s}
                className={`btn ${book.status === s ? "primary" : ""}`}
                onClick={() =>
                  set((b) => {
                    b.status = s;
                    b.isWatched = s === "read";
                    if (s === "read" && !b.watchedAt)
                      b.watchedAt = new Date().toISOString();
                    if (s === "to-read") b.watchedAt = null;
                  })
                }
              >
                {s === "to-read" ? "To read" : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
            <button
              className="btn"
              onClick={() => set((b) => (b.isFavorite = !b.isFavorite))}
            >
              {book.isFavorite ? "♥ Favorite" : "♡ Favorite"}
            </button>
            <Stars
              value={book.rating}
              onChange={(v) => set((b) => (b.rating = v))}
            />
          </div>

          {book.review && (
            <div className="own-review">
              <span className="eyebrow">Your review</span>
              <p className="review-body">{reviewText(book.review)}</p>
            </div>
          )}

          {book.isbn && (
            <div className="idline">
              ISBN {book.isbn}
              {cover ? " · cover from Open Library" : ""}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
