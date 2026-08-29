import React, { useMemo, useState } from "react";
import { Modal, fmtDate } from "../ui.jsx";
import { Cassette } from "../objects.jsx";
import {
  lastPlayedAt,
  podcastProgress,
  inProgressEpisode,
} from "../podcasts.js";

const FILTERS = [
  ["all", "All"],
  ["listening", "Listening"],
  ["subscribed", "Followed"],
];

function matches(p, filter) {
  if (filter === "all") return true;
  if (filter === "listening") return !!inProgressEpisode(p);
  return podcastProgress(p).played > 0;
}

function mins(sec) {
  if (!sec) return null;
  return `${Math.round(sec / 60)} min`;
}

export default function PodcastsView({ lib, query, update, pendingOpen, onPendingConsumed }) {
  const [filter, setFilter] = useState("all");
  const [openUuid, setOpenUuid] = useState(null);
  React.useEffect(() => {
    if (pendingOpen) {
      setOpenUuid(pendingOpen);
      onPendingConsumed?.();
    }
  }, [pendingOpen, onPendingConsumed]);

  const podcasts = lib.podcasts || [];

  const counts = useMemo(() => {
    const c = {};
    for (const [id] of FILTERS) c[id] = podcasts.filter((p) => matches(p, id)).length;
    return c;
  }, [podcasts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return podcasts
      .filter(
        (p) =>
          matches(p, filter) &&
          (!q ||
            p.title.toLowerCase().includes(q) ||
            (p.author || "").toLowerCase().includes(q))
      )
      .sort((a, b) => (lastPlayedAt(b) || "").localeCompare(lastPlayedAt(a) || ""));
  }, [podcasts, filter, query]);

  const open = openUuid ? podcasts.find((p) => p.uuid === openUuid) : null;

  if (!podcasts.length) {
    return (
      <div className="empty-note">
        <h3>No podcasts yet</h3>
        <p>
          Settings → Import Apple Podcasts reads the library Apple Podcasts
          already keeps on this Mac. No account, no export, no API: shows,
          episodes, play dates and how far into each one you got.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="chips">
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            className={`chip ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {label} {counts[id]}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="empty-filter">No podcasts match that filter.</p>
      )}
      <div className="obj-shelf cassettes">
        {shown.map((p) => (
          <Cassette key={p.uuid} podcast={p} onClick={() => setOpenUuid(p.uuid)} />
        ))}
      </div>

      {open && (
        <PodcastDetail
          podcast={open}
          update={update}
          onClose={() => setOpenUuid(null)}
        />
      )}
    </>
  );
}

function PodcastDetail({ podcast, update, onClose }) {
  const { played, total } = podcastProgress(podcast);
  const open = inProgressEpisode(podcast);
  const [showAll, setShowAll] = useState(false);
  const episodes = showAll ? podcast.episodes : podcast.episodes.slice(0, 25);

  const toggleFavorite = () =>
    update((next) => {
      const p = (next.podcasts || []).find((x) => x.uuid === podcast.uuid);
      if (p) p.isFavorite = !p.isFavorite;
    });

  return (
    <Modal onClose={onClose} title={podcast.title}>
      <div className="body">
        <div className="poster-col">
          <Cassette podcast={podcast} caption={false} />
        </div>
        <div className="meta-col">
          <h2>{podcast.title}</h2>
          <div className="subline">
            {[
              podcast.author,
              `${played} of ${total} episodes played`,
              lastPlayedAt(podcast)
                ? `last ${fmtDate(lastPlayedAt(podcast))}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>

          {open && (
            <p className="overview">
              You are {Math.round(open.progress * 100)}% through “{open.title}”.
            </p>
          )}

          <div className="actions">
            <button className="btn" onClick={toggleFavorite}>
              {podcast.isFavorite ? "♥ Favorite" : "♡ Favorite"}
            </button>
          </div>
        </div>
      </div>

      <div className="episodes pod-episodes">
        {episodes.map((e) => (
          <div
            key={e.uuid}
            className={`episode ${e.isWatched ? "watched" : ""}`}
          >
            <span className={`check ${e.isWatched ? "on" : ""}`}>✓</span>
            <span className="name">{e.title}</span>
            {!e.isWatched && e.progress > 0.02 && (
              <span className="pod-progress">{Math.round(e.progress * 100)}%</span>
            )}
            <span className="date">
              {[mins(e.durationSec), e.watchedAt ? fmtDate(e.watchedAt) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
        ))}
        {!showAll && podcast.episodes.length > 25 && (
          <button
            className="btn small"
            style={{ margin: "10px 14px" }}
            onClick={() => setShowAll(true)}
          >
            Show all {podcast.episodes.length}
          </button>
        )}
      </div>
    </Modal>
  );
}
