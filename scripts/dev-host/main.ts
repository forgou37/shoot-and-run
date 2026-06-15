/**
 * Local dedicated host (spec 010, T10.4). The dedicated-server-first plan, minus
 * Cloudflare: a Node process that runs the authoritative `HostRuntime` + sim and
 * serves browser clients over real WebSocket on localhost. Run it with
 * `npm run dev:host`; open two browser tabs at `?online=ws://localhost:8787` to
 * play. When the host graduates to a Cloudflare Durable Object (spec 011), only
 * the transport + this bootstrap change — `packages/net` is untouched.
 *
 * Launch config (NOT game-feel tuning — that stays in content/tuning.json):
 *   PORT     (default 8787)  — ws listen port
 *   PLAYERS  (default 2)     — clients to wait for before starting from tick 0
 *   SEED     (default 1)     — session seed (must match across the session)
 *   ARENA    (default arena-002.json) — arena file under content/arenas/
 *
 * Run via tsx so it consumes the workspace TypeScript (@shoot-and-run/net + sim)
 * directly, the same way Vite/Vitest do — no build step.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHostRuntime, parseNetParams } from "@shoot-and-run/net";
import { TICK_RATE, parseArena, parseTuning } from "@shoot-and-run/sim";
import { createWsTransportServer } from "./ws-transport-server";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readContent = (rel: string): unknown =>
  JSON.parse(readFileSync(join(repoRoot, "content", rel), "utf8"));

const PORT = Number(process.env["PORT"] ?? 8787);
const PLAYERS = Number(process.env["PLAYERS"] ?? 2);
const SEED = Number(process.env["SEED"] ?? 1);
const ARENA_FILE = process.env["ARENA"] ?? "arena-002.json";

const tuningJson = readContent("tuning.json");
const arena = parseArena(readContent(`arenas/${ARENA_FILE}`));
const tuning = parseTuning(tuningJson);
const net = parseNetParams(tuningJson);

const { server, wss } = createWsTransportServer({ port: PORT });
const runtime = createHostRuntime({
  server,
  arena,
  tuning,
  players: Array.from({ length: PLAYERS }, (_, i) => ({ slot: i })),
  seed: SEED,
  snapshotIntervalTicks: net.snapshotIntervalTicks,
  arenaId: arena.name,
  expectedClients: PLAYERS
});

console.log(
  `[dev-host] ws://localhost:${String(PORT)} — arena "${arena.name}", ` +
    `${String(PLAYERS)} players, seed ${String(SEED)}; waiting for clients…`
);

let started = false;
const interval = setInterval(() => {
  const stepped = runtime.step(); // no-op until all expected clients connect
  if (stepped && !started) {
    started = true;
    console.log(`[dev-host] all ${String(PLAYERS)} clients connected — match started`);
  }
}, 1000 / TICK_RATE);

const shutdown = (): void => {
  clearInterval(interval);
  wss.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
