import React, { useEffect, useMemo, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { nextEpisode, epCode, showProgress } from "./ui.jsx";

// Recency as a sort key. A show watched yesterday should outrank one watched in
// 2019 even when both match the query equally well.
function lastWatchedAt(show) {
  let last = "";
  for (const se of show.seasons)
    for (const e of se.episodes)
      if (e.isWatched && e.watchedAt && e.watchedAt > last) last = e.watchedAt;
  return last;
}

const VIEWS = [
  ["discover", "Home"],
  ["search", "Search"],
  ["movies", "Movies"],
  ["shows", "TV Shows"],
  ["watchlist", "To Watch"],
  ["stats", "Stats"],
  ["settings", "Settings"],
];

export default function CommandPalette({
  open,
  onOpenChange,
  lib,
  setView,
  openShow,
  openMovie,
  markNext,
  onSearchTmdb,
}) {
  const [query, setQuery] = useState("");

  // Start every invocation clean; a stale query from last time is never what
  // you meant by pressing ⌘K.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  // What you are part-way through, most recent first. This is the section that
  // justifies the palette: it turns the app's most frequent action, logging the
  // next episode, from seven steps into two keystrokes.
  const continuing = useMemo(() => {
    if (!lib) return [];
    return lib.shows
      .filter((s) => s.status !== "stopped")
      .map((s) => ({ s, next: nextEpisode(s), last: lastWatchedAt(s) }))
      .filter((x) => x.next && x.last)
      .sort((a, b) => b.last.localeCompare(a.last))
      .slice(0, 8);
  }, [lib]);

  const titles = useMemo(() => {
    if (!lib) return [];
    const shows = lib.shows.map((s) => {
      const { watched, total } = showProgress(s);
      return {
        kind: "show",
        uuid: s.uuid,
        title: s.title,
        hint: total ? `${watched}/${total} eps` : "series",
        sort: lastWatchedAt(s),
      };
    });
    const movies = lib.movies.map((m) => ({
      kind: "movie",
      uuid: m.uuid,
      title: m.title,
      hint: m.isWatched ? `watched${m.year ? ` · ${m.year}` : ""}` : "to watch",
      sort: m.watchedAt || m.createdAt || "",
    }));
    return [...shows, ...movies].sort((a, b) => b.sort.localeCompare(a.sort));
  }, [lib]);

  const run = (fn) => {
    onOpenChange(false);
    // Let the dialog finish closing before the app moves underneath it,
    // otherwise focus lands somewhere the user did not ask to be.
    setTimeout(fn, 0);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a title, log an episode, or switch views"
      className="wv-palette"
    >
      <CommandInput
        placeholder="Search your library, or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          Nothing in your library matches that.
        </CommandEmpty>

        {continuing.length > 0 && (
          <CommandGroup heading="Continue watching">
            {continuing.map(({ s, next }) => (
              <CommandItem
                key={`next-${s.uuid}`}
                value={`${s.title} ${epCode(next)} ${next.name || ""} next episode continue`}
                onSelect={() => run(() => markNext(s.uuid))}
              >
                <span className="wv-pal-title">{s.title}</span>
                <span className="wv-pal-sub">
                  {epCode(next)}
                  {next.name ? ` · ${next.name}` : ""}
                </span>
                <CommandShortcut className="wv-pal-hint">mark watched</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {titles.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Library">
              {titles.map((t) => (
                <CommandItem
                  key={`${t.kind}-${t.uuid}`}
                  value={`${t.title} ${t.kind}`}
                  onSelect={() =>
                    run(() =>
                      t.kind === "show" ? openShow(t.uuid) : openMovie(t.uuid)
                    )
                  }
                >
                  <span className="wv-pal-title">{t.title}</span>
                  <span className="wv-pal-sub">{t.hint}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Go to">
          {VIEWS.map(([id, label]) => (
            <CommandItem
              key={id}
              value={`go to ${label}`}
              onSelect={() => run(() => setView(id))}
            >
              <span className="wv-pal-title">{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        {query.trim() && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Elsewhere">
              <CommandItem
                value={`__tmdb__ ${query}`}
                onSelect={() => run(() => onSearchTmdb(query))}
              >
                <span className="wv-pal-title">
                  Search TMDB for “{query.trim()}”
                </span>
                <CommandShortcut className="wv-pal-hint">add a new title</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
