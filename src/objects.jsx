import React from "react";
import { coverUrl } from "./books.js";
import { inProgressEpisode, podcastProgress } from "./podcasts.js";

// Analog objects, built from ONE primitive.
//
// The first attempt gave every medium its own construction: the book got 3D
// layering, the cassette got a moulded plastic shell with reels and screws,
// films kept a plain poster. Three visual languages in one app, which is worse
// than having none.
//
// The thing that makes one primitive possible is that the real objects already
// agree on their proportions:
//
//   film poster        2 : 3      0.667
//   book cover        ~5 : 8      0.625
//   cassette J-card  2.5 : 4      0.625   (the front panel of a Norelco case)
//   VHS sleeve      10.5 : 19     0.553
//
// So they share a frame, a radius, a shadow and a caption, and differ in
// exactly one thing: the material of the edge that shows their depth. Every
// kind is then a few lines, and adding a new one cannot invent a new style.
//
// The rule stays: a physical detail is only allowed if it encodes a fact.
// Edge width is length. Desaturation is abandonment. Nothing else.

/** Depth strip width in px, from whatever "length" means for this kind. */
function edgeWidth(units, perPx, min, max) {
  if (!units) return min + 2;
  return Math.round(Math.min(max, Math.max(min, units / perPx)));
}

/**
 * The primitive. Artwork in a container, with one edge showing its depth.
 *
 * kind    book | tape | film — chooses the edge material only
 * art     image url, or null for a printed face
 * depth   px width of the edge strip
 * square  the source art is square, not portrait. Podcast artwork is 1:1, and
 *         cropping it to a portrait panel cuts the title off the top of every
 *         cover. A real J-card does the same thing this does: show the square
 *         whole at the top, print the name underneath.
 */
function Artifact({
  kind,
  art,
  title,
  sub,
  depth = 8,
  square = false,
  muted = false,
  caption = true,
  onClick,
  children,
}) {
  return (
    <button
      className={`art art--${kind} ${square ? "art--square" : ""} ${
        muted ? "art--muted" : ""
      }`}
      style={{ "--edge": `${depth}px` }}
      onClick={onClick}
      title={sub ? `${title} — ${sub}` : title}
    >
      <span className="art__frame">
        <span className="art__edge" />
        <span className="art__face">
          {art ? (
            <>
              <img src={art} alt="" loading="lazy" draggable="false" />
              {square && <span className="art__stock">{title}</span>}
            </>
          ) : (
            <span className="art__printed">
              <span className="art__printed-title">{title}</span>
              {sub && <span className="art__printed-sub">{sub}</span>}
            </span>
          )}
        </span>
        {children}
      </span>

      {caption && (
        <span className="art__caption">
          <span className="art__title">{title}</span>
          {sub && <span className="art__sub">{sub}</span>}
        </span>
      )}
    </button>
  );
}

// --- Book ------------------------------------------------------------------
// Edge is the fore-edge: the stack of paper. Width is page count.

export function Book({ book, size = "M", onClick, caption = true }) {
  return (
    <Artifact
      kind="book"
      art={coverUrl(book, size)}
      title={book.title}
      sub={book.author}
      depth={edgeWidth(book.pages || book.meta?.pages, 18, 5, 20)}
      muted={book.status === "abandoned"}
      caption={caption}
      onClick={onClick}
    />
  );
}

// --- Cassette --------------------------------------------------------------
// A tape stands in its case, so what you see is the J-card front through clear
// plastic. Edge is the case spine, a constant, because a Norelco box is one
// size whatever is inside it.

export function Cassette({ podcast, onClick, caption = true }) {
  const open = inProgressEpisode(podcast);
  const { played, total } = podcastProgress(podcast);

  return (
    <Artifact
      kind="tape"
      art={podcast.meta?.image || null}
      title={podcast.title}
      sub={
        open
          ? `${Math.round(open.progress * 100)}% through an episode`
          : `${played} of ${total} played`
      }
      depth={9}
      square
      caption={caption}
      onClick={onClick}
    >
      {/* The one thing a case shows that a book does not: how far through the
          tape you are, read off the spine like a progress line. */}
      {open && (
        <span
          className="art__tape-line"
          style={{ "--p": `${Math.round(open.progress * 100)}%` }}
        />
      )}
    </Artifact>
  );
}
