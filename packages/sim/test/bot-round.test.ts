import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import simPackageJson from "../package.json";
import { parseArena } from "../src/arena";
import { createSim, type SimEvent } from "../src/index";
import { parseTuning } from "../src/tuning";
import { hunterBot, patrolBot } from "./bots";

const SEED = 0xbada55;
const MAX_TICKS = 3600;
const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), "golden-bot-round.json");

/**
 * Spec 000 acceptance A8 — the determinism proof: a scripted 2-bot round on
 * the real arena-001 + tuning content, headless in Node, fixed seed. Runs
 * the whole round twice with fresh sim instances; the serialized event logs
 * must be byte-identical.
 */
function runBotRound(): SimEvent[] {
  const sim = createSim({
    arena: parseArena(arena001),
    tuning: parseTuning(tuningJson),
    players: [{ slot: 0 }, { slot: 1 }],
    seed: SEED
  });
  const events: SimEvent[] = [];
  for (let tick = 0; tick < MAX_TICKS; tick++) {
    const out = sim.step([hunterBot(sim.state, tick, 0), patrolBot(sim.state, tick, 1)]);
    events.push(...out);
    if (out.some((e) => e.type === "round_ended")) break;
  }
  return events;
}

describe("headless bot round (spec 000 T0.9 / A8)", () => {
  it("produces byte-identical event logs across runs and completes a round", () => {
    const logA = JSON.stringify(runBotRound());
    const logB = JSON.stringify(runBotRound());
    expect(logA).toBe(logB);

    const events = JSON.parse(logA) as SimEvent[];
    expect(events.filter((e) => e.type === "arrow_fired").length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.type === "player_killed").length).toBeGreaterThanOrEqual(1);
    expect(events.filter((e) => e.type === "round_ended")).toHaveLength(1);
  });

  it("matches the golden log (regenerate consciously: UPDATE_GOLDEN=1 npm test)", () => {
    const log = JSON.stringify(runBotRound(), null, 2);
    if (process.env["UPDATE_GOLDEN"]) {
      writeFileSync(GOLDEN_PATH, log, "utf8");
    }
    const golden = readFileSync(GOLDEN_PATH, "utf8");
    expect(log).toBe(golden);
  });

  it("the sim package depends on nothing (no Phaser in any resolution path)", () => {
    const pkg = simPackageJson as Record<string, unknown>;
    expect(pkg["dependencies"]).toBeUndefined();
    expect(pkg["devDependencies"]).toBeUndefined();
  });
});
