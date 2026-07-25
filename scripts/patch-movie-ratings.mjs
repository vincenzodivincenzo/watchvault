// One-off: apply TV Time movie ratings from the GDPR dump to the app's live
// library (only fills movies with no rating). Safe to re-run.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { applyMovieVotes } from "../src/importer.js";

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = join(here, "..", "..", "gdpr-data", "ratings-live-votes.csv");
const votes = readFileSync(csvPath, "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((l) => {
    const p = l.split(",");
    return { uuid: p[2], vote: Number(p[0].split("-").pop()) };
  })
  .filter((v) => v.uuid && Number.isFinite(v.vote));

const targets = [
  join(os.homedir(), "Library", "Application Support", "com.vincenzo.watchvault", "library.json"),
  join(here, "..", "public", "dev-seed.json"),
];

for (const path of targets) {
  const lib = JSON.parse(readFileSync(path, "utf8"));
  const applied = applyMovieVotes(lib, votes);
  // Keep HIMYM excluded from stats (convert.mjs regenerates the seed without it).
  const himym = lib.shows.find((s) => /how i met your mother/i.test(s.title));
  if (himym) himym.hideFromStats = true;
  writeFileSync(path, JSON.stringify(lib));
  const dist = {};
  for (const m of lib.movies) if (m.rating) dist[m.rating] = (dist[m.rating] || 0) + 1;
  console.log(path, "→ applied", applied, "ratings; distribution", dist);
}
