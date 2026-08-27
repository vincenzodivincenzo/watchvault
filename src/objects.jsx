import React from "react";
import { coverUrl } from "./books.js";

// Analog objects.
//
// The principle: an item is drawn as the physical artifact its content would
// have had, and its state is expressed through that object's physical
// properties rather than through badges bolted on top.
//
// The rule that keeps it from becoming decoration: a physical detail is only
// allowed if it encodes a fact. Thickness is page count. The ribbon's height is
// how far in you stopped. Desaturation is abandonment. Nothing is here because
// it looks booky.

// Page count → millimetres of spine, in a range that stays legible on a shelf.
// Real books run about 250 pages to 20mm; this exaggerates slightly so the
// difference between a novella and Seneca is visible at thumbnail size.
function thickness(pages) {
  if (!pages) return 14;
  return Math.round(Math.min(46, Math.max(7, pages / 9)));
}

// Where the ribbon sits. Goodreads gives no page position, so a book being read
// shows a ribbon at a neutral third rather than inventing precision it does not
// have. An abandoned book shows it further in, because stopping is itself the
// fact worth recording.
function ribbonDepth(book) {
  if (book.status === "reading") return 34;
  if (book.status === "abandoned") return 62;
  return null;
}

export function Book({ book, size = "M", onClick, caption = true }) {
  const t = thickness(book.pages || book.meta?.pages);
  const cover = coverUrl(book, size);
  const ribbon = ribbonDepth(book);

  return (
    <button
      className={`obj obj-book status-${book.status}`}
      style={{ "--t": `${t}px` }}
      onClick={onClick}
      title={`${book.title}${book.author ? ` — ${book.author}` : ""}`}
    >
      <span className="obj-book__body">
        {/* Front board. The cover image is the board's face, not a separate
            picture sitting on top of it. */}
        <span className="obj-book__front">
          {cover ? (
            <img src={cover} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="obj-book__blank">
              <span className="t">{book.title}</span>
              {book.author && <span className="a">{book.author}</span>}
            </span>
          )}
        </span>

        {/* Spine. Carries the title when there is no cover art, which is how a
            real shelf works. */}
        <span className="obj-book__spine" />

        {/* The fore-edge: the actual stack of paper, ruled so thickness reads
            as pages rather than as a drop shadow. */}
        <span className="obj-book__edge" />

        {ribbon !== null && (
          <span className="obj-book__ribbon" style={{ "--d": `${ribbon}%` }} />
        )}
      </span>

      {caption && (
        <span className="obj-caption">
          <span className="obj-title">{book.title}</span>
          {book.author && <span className="obj-sub">{book.author}</span>}
        </span>
      )}
    </button>
  );
}
