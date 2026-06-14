import {
  createSim,
  parseArena,
  parseTuning,
  type ArenaData,
  type SimEvent
} from "@shoot-and-run/sim";
import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import botsJson from "../../../content/bots.json";
import tuningJson from "../../../content/tuning.json";
import botsPackageJson from "../package.json";
import { botDifficulty, parseBotConfig } from "../src/config";
import { botSeed, makeBot } from "../src/bot";

const config = parseBotConfig(botsJson);
const tuning = parseTuning(tuningJson);

/**
 * Flat duel arena: a solid floor, four spawns, the first two close together so
 * two bots reliably close to firing range and finish a round. Determinism holds
 * on any arena; this one just guarantees termination for the smoke assertions
 * (long-range shots miss under arrow gravity, so engagement must be close).
 */
function flatArena(): ArenaData {
  return parseArena({
    name: "flat-duel",
    tiles: Array.from({ length: 15 }, (_, r) => (r >= 13 ? "#".repeat(20) : ".".repeat(20))),
    spawns: [
      { x: 110, y: 200 },
      { x: 210, y: 200 },
      { x: 40, y: 200 },
      { x: 280, y: 200 }
    ]
  });
}

/** Run a 2-bot round/match headlessly, returning the full event log. Stops at
 *  `until` (round_ended or match_ended) or `maxTicks`, whichever comes first. */
function runBots(
  arena: ArenaData,
  difficultyName: string,
  seed: number,
  maxTicks: number,
  until: "round_ended" | "match_ended" | null
): SimEvent[] {
  const sim = createSim({ arena, tuning, players: [{ slot: 0 }, { slot: 1 }], seed });
  const diff = botDifficulty(config, difficultyName);
  const bots = [0, 1].map((slot) => makeBot({ seed: botSeed(seed, slot), slot, difficulty: diff, arena }));
  const events: SimEvent[] = [];
  for (let tick = 0; tick < maxTicks; tick++) {
    const out = sim.step(bots.map((b) => b.input(sim.state)));
    events.push(...out);
    if (until && out.some((e) => e.type === until)) break;
  }
  return events;
}

describe("headless bot match (spec 004 A4.5)", () => {
  it("two bots finish a round with a kill, byte-identical across runs", () => {
    const a = runBots(flatArena(), "hard", 0xb07, 4000, "round_ended");
    const b = runBots(flatArena(), "hard", 0xb07, 4000, "round_ended");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // determinism

    expect(a.filter((e) => e.type === "player_killed").length).toBeGreaterThanOrEqual(1);
    expect(a.filter((e) => e.type === "round_ended")).toHaveLength(1);
  });

  it("is deterministic on the real arena-001 content over a fixed budget", () => {
    const arena = parseArena(arena001);
    const a = runBots(arena, "normal", 0xc0ffee, 1500, null);
    const b = runBots(arena, "normal", 0xc0ffee, 1500, null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThan(0);
  });

  it("plays a full best-of-N match to a decisive match_ended", () => {
    const events = runBots(flatArena(), "hard", 0x5eed, 40000, "match_ended");
    const ended = events.filter((e) => e.type === "match_ended");
    expect(ended).toHaveLength(1);
    // roundsToWin from tuning.json; the winner must have reached it.
    const matchEnd = ended[0];
    if (matchEnd && matchEnd.type === "match_ended") {
      expect(Math.max(...matchEnd.scores)).toBeGreaterThanOrEqual(tuning.roundsToWin);
    }
  });

  it("each difficulty preset can finish a round (no behavior dead-ends)", () => {
    for (const name of Object.keys(config.difficulties)) {
      const events = runBots(flatArena(), name, 0xd1ce, 8000, "round_ended");
      expect(events.some((e) => e.type === "round_ended"), `${name} stalled`).toBe(true);
    }
  });
});

describe("bots package purity (spec 004 A4.1)", () => {
  it("depends only on the sim — no Phaser anywhere in the tree", () => {
    const pkg = botsPackageJson as Record<string, unknown>;
    expect(pkg["dependencies"]).toEqual({ "@shoot-and-run/sim": "*" });
    expect(pkg["devDependencies"]).toBeUndefined();
  });
});
