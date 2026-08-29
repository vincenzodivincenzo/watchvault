// Apple Podcasts → Arca.
//
// There is no Apple Podcasts API, but the app keeps a Core Data SQLite store in
// its group container and it is readable. The Rust side copies it and returns
// one row per episode with real play state; this file turns those rows into
// shelf items grouped by show.
//
// What this gets that no screen source does: partial listens. Every episode
// carries a playhead, so "abandoned 40% in" is a measurable fact rather than an
// inference.

import { isTauri } from "./store.js";

// Core Data counts seconds from 2001-01-01.
const APPLE_EPOCH_OFFSET = 978307200;

function appleTimeToIso(seconds) {
  if (!seconds && seconds !== 0) return null;
  const ms = (seconds + APPLE_EPOCH_OFFSET) * 1000;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

// Apple's ZPLAYSTATE: 3 means played to the end. Anything else with a playhead
// is a partial listen.
const PLAYED = 3;

function episodeFromRow(r) {
  const duration = r.duration || 0;
  const playhead = r.playhead || 0;
  const finished = r.playState === PLAYED || (r.playCount || 0) > 0;
  // Guard against a playhead past the end, which Apple does record.
  const progress = duration > 0 ? Math.min(1, playhead / duration) : 0;
  return {
    uuid: r.uuid || crypto.randomUUID(),
    title: r.title || "Untitled episode",
    description: r.description || null,
    durationSec: duration || null,
    playheadSec: playhead || null,
    progress,
    isWatched: finished,
    watchedAt: appleTimeToIso(r.lastPlayed),
    publishedAt: appleTimeToIso(r.pubDate),
  };
}

/**
 * Group the flat episode rows into one item per podcast.
 *
 * Grouping on the feed URL rather than the title: two shows can share a title,
 * and a show can be renamed without changing feed.
 */
export function podcastsFromRows(rows) {
  const byFeed = new Map();
  for (const r of rows) {
    const key = r.feedUrl || r.podcast || "unknown";
    if (!byFeed.has(key)) {
      byFeed.set(key, {
        uuid: crypto.randomUUID(),
        kind: "podcast",
        title: r.podcast || "Untitled podcast",
        author: r.author || null,
        feedUrl: r.feedUrl || null,
        isFavorite: false,
        rating: null,
        createdAt: new Date().toISOString(),
        meta: { image: r.imageUrl || null },
        episodes: [],
      });
    }
    byFeed.get(key).episodes.push(episodeFromRow(r));
  }

  for (const p of byFeed.values()) {
    // Newest first is how a podcast feed reads.
    p.episodes.sort((a, b) =>
      (b.publishedAt || "").localeCompare(a.publishedAt || "")
    );
  }
  return [...byFeed.values()].sort(
    (a, b) => (lastPlayedAt(b) || "").localeCompare(lastPlayedAt(a) || "")
  );
}

export function lastPlayedAt(pod) {
  let last = null;
  for (const e of pod.episodes)
    if (e.watchedAt && (!last || e.watchedAt > last)) last = e.watchedAt;
  return last;
}

export function podcastProgress(pod) {
  const played = pod.episodes.filter((e) => e.isWatched).length;
  return { played, total: pod.episodes.length };
}

// An episode you started and left. This is the thing podcasts can tell you
// that a film library cannot.
export function inProgressEpisode(pod) {
  return (
    pod.episodes.find((e) => !e.isWatched && e.progress > 0.02 && e.progress < 0.95) ||
    null
  );
}

export async function readApplePodcasts() {
  if (!isTauri()) throw new Error("Reading Apple Podcasts needs the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  const json = await invoke("read_apple_podcasts");
  return JSON.parse(json);
}

// Merge into an existing shelf. Never un-plays an episode, matching how every
// other importer here behaves.
export function mergePodcasts(existing, incoming) {
  const out = [...(existing || [])];
  const index = new Map(out.map((p) => [p.feedUrl || p.title, p]));
  const report = { added: 0, merged: 0, episodesAdded: 0 };

  for (const p of incoming) {
    const key = p.feedUrl || p.title;
    const cur = index.get(key);
    if (!cur) {
      out.push(p);
      index.set(key, p);
      report.added++;
      report.episodesAdded += p.episodes.length;
      continue;
    }
    const byId = new Map(cur.episodes.map((e) => [e.uuid, e]));
    for (const e of p.episodes) {
      const have = byId.get(e.uuid);
      if (!have) {
        cur.episodes.push(e);
        report.episodesAdded++;
      } else {
        if (e.isWatched && !have.isWatched) {
          have.isWatched = true;
          have.watchedAt = e.watchedAt || have.watchedAt;
        }
        have.progress = Math.max(have.progress || 0, e.progress || 0);
        have.playheadSec = Math.max(have.playheadSec || 0, e.playheadSec || 0);
      }
    }
    cur.episodes.sort((a, b) =>
      (b.publishedAt || "").localeCompare(a.publishedAt || "")
    );
    cur.meta = cur.meta || p.meta;
    report.merged++;
  }
  return { podcasts: out, report };
}
