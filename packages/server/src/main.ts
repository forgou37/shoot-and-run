/**
 * Dedicated-host CLI entry (spec 011, T11.1 — graduated from `scripts/dev-host`).
 * A Node process that runs the authoritative `HostRuntime` + sim and serves
 * browser clients over real WebSocket. The dedicated-server-first plan, minus
 * Cloudflare: run it on a VPS (or locally) and friends connect from the GitHub-
 * Pages client via the Online menu.
 *
 * Run locally with `npm run dev:host` (or `npm run start:host`); see the
 * deployment doc for running it on a VPS behind TLS.
 *
 * Launch config (env — NOT game-feel tuning, which stays in content/tuning.json):
 *   PORT        (default 8787)              — ws listen port
 *   HOST        (default all interfaces)    — bind address
 *   PLAYERS     (default 2)                 — clients to wait for before tick 0
 *   SEED        (default 1)                 — session seed (must match the session)
 *   ARENA       (default arena-002.json)    — arena file under content/arenas/
 *   CONTENT_DIR (default repo /content)     — content root (for non-repo deploys)
 *   TLS_CERT / TLS_KEY (optional)           — PEM file paths → serve wss:// directly
 *
 * Run via tsx so it consumes the workspace TypeScript (@shoot-and-run/net + sim)
 * directly, the same way Vite/Vitest do — no separate build step.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNetParams } from "@shoot-and-run/net";
import { parseArena, parseTuning } from "@shoot-and-run/sim";
import { startHost } from "./start";

// Content root: CONTENT_DIR env, else repo-root /content (this file lives at
// packages/server/src/main.ts → repo root is three levels up).
const here = dirname(fileURLToPath(import.meta.url));
const contentDir = process.env["CONTENT_DIR"]
  ? resolve(process.env["CONTENT_DIR"])
  : join(here, "..", "..", "..", "content");
const readContent = (rel: string): unknown =>
  JSON.parse(readFileSync(join(contentDir, rel), "utf8"));

const PORT = Number(process.env["PORT"] ?? 8787);
const HOST = process.env["HOST"]; // undefined → all interfaces
const PLAYERS = Number(process.env["PLAYERS"] ?? 2);
const SEED = Number(process.env["SEED"] ?? 1);
const ARENA_FILE = process.env["ARENA"] ?? "arena-002.json";

const certPath = process.env["TLS_CERT"];
const keyPath = process.env["TLS_KEY"];
const tls =
  certPath && keyPath
    ? { cert: readFileSync(resolve(certPath), "utf8"), key: readFileSync(resolve(keyPath), "utf8") }
    : undefined;

const tuningJson = readContent("tuning.json");
const arena = parseArena(readContent(`arenas/${ARENA_FILE}`));
const tuning = parseTuning(tuningJson);
const net = parseNetParams(tuningJson);

const { stop } = startHost({
  port: PORT,
  host: HOST,
  players: PLAYERS,
  seed: SEED,
  arena,
  tuning,
  snapshotIntervalTicks: net.snapshotIntervalTicks,
  maxSpectators: net.maxSpectators,
  tls,
  onStarted: () => console.log(`[host] all ${String(PLAYERS)} clients connected — match started`)
});

const scheme = tls ? "wss" : "ws";
console.log(
  `[host] ${scheme}://${HOST ?? "localhost"}:${String(PORT)} — arena "${arena.name}", ` +
    `${String(PLAYERS)} players, seed ${String(SEED)}; waiting for clients…`
);

const shutdown = (): void => {
  stop(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
