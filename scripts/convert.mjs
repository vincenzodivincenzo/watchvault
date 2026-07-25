// Converts the TV Time export sitting next to this project into a WatchVault
// library.json. Usage:
//   node scripts/convert.mjs                 → writes public/dev-seed.json
//   node scripts/convert.mjs --install       → also installs as the app's library
//
// Looks for tvtime-movies-*.json / tvtime-series-*.json in the parent folder
// and show ratings in ../gdpr-data/tv_show_rate.csv.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { importTvTimeFiles, applyShowRatings, applyMovieVotes } from "../src/importer.js";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const exportDir = join(projectRoot, "..");

const files = [];
for (const name of readdirSync(exportDir)) {
  if (/^tvtime-(movies|series).*\.json$/.test(name)) {
    files.push({ name, text: readFileSync(join(exportDir, name), "utf8") });
  }
}
if (files.length === 0) {
  console.error(`No tvtime-*.json export files found in ${exportDir}`);
  process.exit(1);
}
console.log("Importing:", files.map((f) => f.name).join(", "));

const { library, report } = importTvTimeFiles(files, null);
console.log(report);

// Show ratings from the GDPR dump (1–5 stars), matched by title.
const ratingsCsv = join(exportDir, "gdpr-data", "tv_show_rate.csv");
if (existsSync(ratingsCsv)) {
  const lines = readFileSync(ratingsCsv, "utf8").trim().split("\n").slice(1);
  const ratings = lines
    .map((l) => {
      // name may contain commas only if quoted; this file uses plain names
      const parts = l.split(",");
      return { name: parts[0], rating: Number(parts[3]) };
    })
    .filter((r) => r.name && Number.isFinite(r.rating));
  const applied = applyShowRatings(library, ratings);
  console.log(`Applied ${applied}/${ratings.length} show ratings`);
}

// Movie ratings from the GDPR dump (vote-option ids in vote_key), matched by uuid.
const votesCsv = join(exportDir, "gdpr-data", "ratings-live-votes.csv");
if (existsSync(votesCsv)) {
  const lines = readFileSync(votesCsv, "utf8").trim().split("\n").slice(1);
  const votes = lines
    .map((l) => {
      const parts = l.split(",");
      return { uuid: parts[2], vote: Number(parts[0].split("-").pop()) };
    })
    .filter((v) => v.uuid && Number.isFinite(v.vote));
  const applied = applyMovieVotes(library, votes);
  console.log(`Applied ${applied}/${votes.length} movie ratings`);
}

const json = JSON.stringify(library);

const devSeed = join(projectRoot, "public", "dev-seed.json");
mkdirSync(dirname(devSeed), { recursive: true });
writeFileSync(devSeed, json);
console.log("Wrote", devSeed);

if (process.argv.includes("--install")) {
  const appData = join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.vincenzo.watchvault"
  );
  mkdirSync(appData, { recursive: true });
  const target = join(appData, "library.json");
  if (existsSync(target)) {
    console.error(`Refusing to overwrite existing ${target} — the app already has data.`);
    process.exit(2);
  }
  writeFileSync(target, json);
  console.log("Installed library at", target);
}
