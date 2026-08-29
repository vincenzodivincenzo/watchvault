import React from "react";
import { coverUrl } from "./books.js";

// Analog objects.
//
// The principle: an item is drawn as the physical artifact its content would
// have had, and its state is expressed through that object's physical
// properties rather than through badges bolted on top.
//
// The rule that keeps it from becoming decoration: a physical detail is only
// allowed if it encodes a fact. Thickness is page count. Desaturation is
// abandonment. Nothing is here because it looks booky.

// Page count → width of the visible fore-edge, in a range that stays legible
// at thumbnail size. Exaggerated slightly against real proportions so the
// difference between a novella and Seneca actually reads on a shelf.
function thickness(pages) {
  if (!pages) return 14;
  return Math.round(Math.min(22, Math.max(5, pages / 18)));
}

export function Book({ book, size = "M", onClick, caption = true }) {
  const t = thickness(book.pages || book.meta?.pages);
  const cover = coverUrl(book, size);

  return (
    <button
      className={`obj obj-book status-${book.status}`}
      style={{ "--t": `${t}px` }}
      onClick={onClick}
      title={`${book.title}${book.author ? ` — ${book.author}` : ""}`}
    >
      <span className="obj-book__body">
        {/* The page block, behind and to the right of the board. */}
        <span className="obj-book__edge" />

        {/* The front board. The cover image is the board's face, not a
            separate picture sitting on top of it. */}
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

        {/* The hinge where the board wraps the binding. */}
        <span className="obj-book__spine" />
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
