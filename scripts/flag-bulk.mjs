// One-off: run bulk-log detection over the app's live library and the dev
// seed, so imported TV Time history stops polluting time-based analytics.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { detectBulkFlags, countBulkFlags } from "../src/bulk.js";

const here = dirname(fileURLToPath(import.meta.url));
const targets = [
  join(os.homedir(), "Library", "Application Support", "com.vincenzo.watchvault", "library.json"),
  join(here, "..", "public", "dev-seed.json"),
];

for (const path of targets) {
  if (!existsSync(path)) {
    console.log("skip (missing):", path);
    continue;
  }
  const lib = JSON.parse(readFileSync(path, "utf8"));
  const report = detectBulkFlags(lib);
  writeFileSync(path, JSON.stringify(lib));
  console.log(
    path,
    "→",
    report,
    `(total flagged now: ${countBulkFlags(lib)})`
  );
}
