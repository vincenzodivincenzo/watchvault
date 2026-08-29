// Storage abstraction: Tauri backend when running inside the app,
// localStorage fallback when running in a plain browser (dev/testing).

const LS_KEY = "watchvault-library";

export const isTauri = () =>
  typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

async function invoke(cmd, args) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke(cmd, args);
}

export function emptyLibrary() {
  return {
    version: 1,
    settings: { tmdbKey: "" },
    movies: [],
    shows: [],
    books: [],
    notInterested: [],
  };
}

// TV Time exported a per-show `status` string (up_to_date | continuing |
// stopped | not_started_yet), but only "stopped" is ever read: every other
// progress question is answered from the episodes themselves, via showState().
// The imported values were never recomputed, so marking a show watched in bulk
// left `status` contradicting its own episode data. Keep "stopped", which the
// user sets by hand, and drop the rest wherever a library enters the app.
export function normalizeLibrary(lib) {
  if (!lib || !Array.isArray(lib.shows)) return lib;
  for (const s of lib.shows) {
    if (s.status && s.status !== "stopped") s.status = null;
  }
  return lib;
}

export async function loadLibrary() {
  if (isTauri()) {
    const raw = await invoke("load_library");
    return raw ? normalizeLibrary(JSON.parse(raw)) : null;
  }
  const raw = localStorage.getItem(LS_KEY);
  return raw ? normalizeLibrary(JSON.parse(raw)) : null;
}

export async function saveLibrary(lib) {
  const json = JSON.stringify(lib);
  if (isTauri()) {
    await invoke("save_library", { data: json });
  } else {
    localStorage.setItem(LS_KEY, json);
  }
}

export async function getLibraryPath() {
  if (isTauri()) return invoke("library_file_path");
  return "browser localStorage (dev mode)";
}

// Returns [{name, text}] for user-picked JSON files.
export async function pickImportFiles() {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({
      multiple: true,
      title: "Select your TV Time export files",
      filters: [{ name: "TV Time export", extensions: ["json"] }],
    });
    if (!paths) return [];
    const list = Array.isArray(paths) ? paths : [paths];
    const out = [];
    for (const p of list) {
      const text = await invoke("read_text_file", { path: p });
      out.push({ name: p.split("/").pop(), text });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])];
      const out = [];
      for (const f of files) out.push({ name: f.name, text: await f.text() });
      resolve(out);
    };
    input.click();
  });
}

// Same picker as the TV Time import, filtered to CSV for the Goodreads export.
export async function pickCsvFiles() {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const paths = await open({
      multiple: true,
      title: "Select your Goodreads CSV export",
      filters: [{ name: "Goodreads export", extensions: ["csv"] }],
    });
    if (!paths) return [];
    const list = Array.isArray(paths) ? paths : [paths];
    const out = [];
    for (const p of list) {
      const text = await invoke("read_text_file", { path: p });
      out.push({ name: p.split("/").pop(), text });
    }
    return out;
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.multiple = true;
    input.onchange = async () => {
      const files = [...(input.files || [])];
      const out = [];
      for (const f of files) out.push({ name: f.name, text: await f.text() });
      resolve(out);
    };
    input.click();
  });
}

export async function exportBackup(lib) {
  const json = JSON.stringify(lib, null, 2);
  const filename = `watchvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      title: "Export WatchVault backup",
      defaultPath: filename,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return false;
    await invoke("write_text_file", { path, data: json });
    return true;
  }
  const blob = new Blob([json], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  return true;
}
