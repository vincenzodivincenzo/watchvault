import React from "react";
import { Modal, Stars } from "./ui.jsx";

// The description card.
//
// Every title in the app opens this same sheet: a film you logged in 2019, a
// series you are half-way through, a result the catalogue handed back thirty
// seconds ago. They differ in which actions they are given
// and in nothing else — not layout, not spacing, not which buttons exist.
//
// It exists because the sheets had drifted. Each view drew its own, so
// Favorite was on films and series but missing from anything not yet added,
// the date field sat on a row with `alignItems: center` in one file and not in
// another, and three different inline margins separated the button rows. None
// of that was a decision; it was five copies aging apart. Spacing now lives in
// one stylesheet rule and the actions are data.
//
// An action is { id, label, onClick, variant, active, disabled, title }:
//   variant  "primary" for the one action the sheet is really for, "danger"
//            for destructive, omitted for everything else
//   active   a toggle that is currently on (Favorite)
export function DetailCard({
  onClose,
  title,
  art,
  backdropUrl,
  facts = [],
  notes = [],
  tags = [],
  extra = null,
  overview,
  aside = null,
  actions = [],
  minorActions = [],
  rating = null,
  hint = null,
  footer = null,
  children,
}) {
  const parts = facts.filter(Boolean);
  return (
    <Modal onClose={onClose} title={title}>
      <div
        className="backdrop"
        style={backdropUrl ? { backgroundImage: `url(${backdropUrl})` } : { height: 90 }}
      />
      <div className="body">
        <div className="poster-col">{art}</div>
        <div className="meta-col">
          <h2>{title}</h2>
          {parts.length > 0 && (
            <div className="subline">
              {parts.map((p, i) => (
                <React.Fragment key={i}>
                  {i > 0 && " · "}
                  {p}
                </React.Fragment>
              ))}
            </div>
          )}
          {notes.filter(Boolean).map((n, i) => (
            <div className="subline" key={i}>
              {n}
            </div>
          ))}
          {tags.length > 0 && (
            <div className="genres">
              {tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
          )}
          {extra}
          {overview && <p className="overview">{overview}</p>}
          {aside && <div className="detail-aside">{aside}</div>}
          <ActionRow actions={actions} rating={rating} />
          {minorActions.length > 0 && <ActionRow actions={minorActions} minor />}
          {hint && <p className="hint detail-hint">{hint}</p>}
          {footer}
        </div>
      </div>
      {children}
    </Modal>
  );
}

function ActionRow({ actions, rating = null, minor = false }) {
  const list = actions.filter(Boolean);
  if (!list.length && !rating) return null;
  return (
    <div className={`detail-actions ${minor ? "minor" : ""}`}>
      {list.map((a) => (
        <button
          key={a.id}
          className={[
            "btn",
            minor ? "small" : "",
            a.variant === "primary" ? "primary" : "",
            a.variant === "danger" ? "small danger" : "",
            a.active ? "on" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          disabled={a.disabled}
          title={a.title}
          onClick={a.onClick}
        >
          {a.label}
        </button>
      ))}
      {rating && <Stars value={rating.value || 0} onChange={rating.onChange} />}
    </div>
  );
}

// Favorite reads the same everywhere, so it is written once. A title you do
// not own yet can still be favourited — that is the whole point of the shelves
// and the catalogue being one surface — so the caller decides whether pressing
// it toggles a flag or adds the title first.
export function favoriteAction(isFavorite, onToggle, { disabled } = {}) {
  return {
    id: "favorite",
    label: isFavorite ? "❤️ Favorite" : "🤍 Favorite",
    active: isFavorite,
    disabled,
    onClick: onToggle,
  };
}
