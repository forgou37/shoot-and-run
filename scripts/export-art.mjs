// Re-exports every Aseprite source in assets/ into the atlases the game
// loads from packages/game/public/assets/. Exports are committed; CI and
// the build never need Aseprite (spec 006 A6.1).
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const SOURCES_DIR = "assets";
const OUT_DIR = join("packages", "game", "public", "assets");

const candidates = [
  process.env.ASEPRITE,
  "C:\\Program Files\\Aseprite\\aseprite.exe",
  "/Applications/Aseprite.app/Contents/MacOS/aseprite",
  "aseprite"
].filter(Boolean);

function findAseprite() {
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error("Aseprite not found — set the ASEPRITE env var to its executable path.");
}

const aseprite = findAseprite();
const sources = readdirSync(SOURCES_DIR).filter((f) => f.endsWith(".aseprite"));
if (sources.length === 0) throw new Error(`no .aseprite sources found in ${SOURCES_DIR}/`);

mkdirSync(OUT_DIR, { recursive: true });
for (const source of sources) {
  const name = basename(source, ".aseprite");
  execFileSync(
    aseprite,
    [
      "-b",
      join(SOURCES_DIR, source),
      "--sheet-type",
      "horizontal",
      "--filename-format",
      "{title} {frame}.{extension}",
      "--format",
      "json-hash",
      "--list-tags",
      "--list-layers",
      "--sheet",
      join(OUT_DIR, `${name}.png`),
      "--data",
      join(OUT_DIR, `${name}.json`)
    ],
    { stdio: "inherit" }
  );
  console.log(`exported ${name} (${join(OUT_DIR, name)}.png/.json)`);
}
