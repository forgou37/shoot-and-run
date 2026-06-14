import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { parseArena } from "../src/arena";
import { createSim } from "../src/index";
import { parseTuning } from "../src/tuning";
import { hunterBot, patrolBot } from "./bots";

/**
 * T8.5 / N6 — cross-engine determinism guard. A checked-in FNV-1a hash of the
 * full snapshot() (SimState + RNG state + entity counter) sampled every K ticks
 * of the scripted-bot round. Linux CI re-running this against the fixture
 * produced on the Windows dev box extends the existing golden-event-log proof
 * down to the byte level of every captured field, and is the partial proof that
 * the sim is cross-machine deterministic (the precondition for host-authoritative
 * rollback — Decision 008). Browser-engine verification is wired in 010.
 */

const SEED = 0xbada55;
const TICKS = 600; // spans at least one round end + reset
const HASH_EVERY = 30;
const GOLDEN_PATH = join(dirname(fileURLToPath(import.meta.url)), "golden-state-hashes.json");

/** FNV-1a, 32-bit. Math.imul keeps the multiply bit-exact across engines. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function runHashes(): { tick: number; hash: number }[] {
  const sim = createSim({
    arena: parseArena(arena001),
    tuning: parseTuning(tuningJson),
    players: [{ slot: 0 }, { slot: 1 }],
    seed: SEED
  });
  const samples: { tick: number; hash: number }[] = [];
  for (let t = 0; t < TICKS; t++) {
    if (t % HASH_EVERY === 0) samples.push({ tick: t, hash: fnv1a(JSON.stringify(sim.snapshot())) });
    sim.step([hunterBot(sim.state, t, 0), patrolBot(sim.state, t, 1)]);
  }
  samples.push({ tick: TICKS, hash: fnv1a(JSON.stringify(sim.snapshot())) });
  return samples;
}

describe("cross-engine determinism guard (T8.5 / N6)", () => {
  it("produces a stable state-hash sequence run-to-run", () => {
    expect(runHashes()).toEqual(runHashes());
  });

  it("matches the golden state-hash sequence (regenerate consciously: UPDATE_GOLDEN=1 npm test)", () => {
    const seq = JSON.stringify(runHashes(), null, 2);
    if (process.env["UPDATE_GOLDEN"]) {
      writeFileSync(GOLDEN_PATH, seq, "utf8");
    }
    expect(seq).toBe(readFileSync(GOLDEN_PATH, "utf8"));
  });
});
