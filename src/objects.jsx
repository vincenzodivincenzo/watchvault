import React from "react";
import { coverUrl } from "./books.js";
import { inProgressEpisode, podcastProgress } from "./podcasts.js";

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


// ---------------------------------------------------------------------------
// Cassette
//
// A podcast is a tape in its case: cover art on the label, two reels behind the
// window. The reels are the encoding. Tape moves from the left hub to the right
// as you listen, so their relative fill is your position in the episode you are
// part way through. A show with nothing open shows a rewound tape.

const REEL_MIN = 22; // an empty hub still has the spool itself
const REEL_MAX = 46;

export function Cassette({ podcast, onClick, caption = true }) {
  const open = inProgressEpisode(podcast);
  const { played, total } = podcastProgress(podcast);
  const p = open ? open.progress : 0;

  // Radii in percent of the reel box. Left gives up what right takes on.
  const left = REEL_MAX - (REEL_MAX - REEL_MIN) * p;
  const right = REEL_MIN + (REEL_MAX - REEL_MIN) * p;
  const art = podcast.meta?.image || null;

  return (
    <button
      className={`obj obj-cassette ${open ? "playing" : ""}`}
      onClick={onClick}
      title={`${podcast.title}${podcast.author ? ` — ${podcast.author}` : ""}`}
    >
      <span className="obj-cassette__shell">
        <span className="obj-cassette__label">
          {art ? (
            <img src={art} alt="" loading="lazy" draggable="false" />
          ) : (
            <span className="obj-cassette__printed">{podcast.title}</span>
          )}
        </span>

        {/* The window, and the two reels behind it. */}
        <span className="obj-cassette__window">
          <span
            className="obj-cassette__reel"
            style={{ "--r": `${left}%` }}
          />
          <span
            className="obj-cassette__reel"
            style={{ "--r": `${right}%` }}
          />
        </span>

        <span className="obj-cassette__screws" />
      </span>

      {caption && (
        <span className="obj-caption">
          <span className="obj-title">{podcast.title}</span>
          <span className="obj-sub">
            {open
              ? `${Math.round(p * 100)}% through an episode`
              : `${played} of ${total} played`}
          </span>
        </span>
      )}
    </button>
  );
}
