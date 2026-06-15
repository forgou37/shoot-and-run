import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import tuningJson from "../../../content/tuning.json";
import { createSim, emptyInput, parseArena, parseTuning, type PlayerInput } from "@shoot-and-run/sim";
import { createRollbackController } from "../src/rollback";

const arena = parseArena(arena001);
const tuning = parseTuning(tuningJson);
const SEED = 0xbada55;
const players = [{ slot: 0 }, { slot: 1 }];

function flag(f: keyof PlayerInput): PlayerInput {
  return { ...emptyInput(), [f]: true };
}

/** Reference sim stepped with an explicit (true) input sequence. */
function reference(inputs: PlayerInput[][]) {
  const sim = createSim({ arena, tuning, players, seed: SEED });
  for (const i of inputs) sim.step(i);
  return sim.snapshot();
}

function makeController(localSlot: number, maxRollbackTicks = 120) {
  return createRollbackController({ arena, tuning, players, seed: SEED, localSlot, maxRollbackTicks });
}

describe("rollback controller (T9.4 / M5)", () => {
  it("no correction when the authoritative inputs match the prediction", () => {
    const c = makeController(0);
    const local = flag("right");
    c.predict(0, local); // guesses remote slot 1 = empty (repeat-last default)
    const corrected = c.confirm(0, [local, emptyInput()]); // matches the guess
    expect(corrected).toBe(false);
    expect(c.confirmedTick).toBe(1);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(reference([[local, emptyInput()]])));
  });

  it("a changed remote input causes a correction; confirmed equals the host", () => {
    const c = makeController(0);
    const local = flag("right");
    c.predict(0, local); // guessed remote = empty
    const corrected = c.confirm(0, [local, flag("left")]); // remote actually pressed left
    expect(corrected).toBe(true);
    const truth = reference([[local, flag("left")]]);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(truth));
    // prediction caught up to the corrected ground truth
    expect(JSON.stringify(c.snapshotPredicted())).toBe(JSON.stringify(truth));
  });

  it("rolls back once, then later confirms cheaply (no second correction)", () => {
    const c = makeController(0);
    const l = [flag("right"), flag("jump"), flag("shoot")];
    c.predict(0, l[0]!);
    c.predict(1, l[1]!);
    c.predict(2, l[2]!);
    expect(c.predictedTick).toBe(3);

    const r = flag("left");
    expect(c.confirm(0, [l[0]!, r])).toBe(true); // first remote input differs -> rollback
    // ticks 1 and 2 were re-simmed assuming remote repeat-lasts `r`, so the
    // matching authoritative confirms without a further correction:
    expect(c.confirm(1, [l[1]!, r])).toBe(false);
    expect(c.confirm(2, [l[2]!, r])).toBe(false);

    expect(c.confirmedTick).toBe(3);
    const truth = reference([
      [l[0]!, r],
      [l[1]!, r],
      [l[2]!, r]
    ]);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(truth));
  });

  it("confirmed state tracks the host across a long mixed sequence", () => {
    const c = makeController(0);
    const localOf = (t: number): PlayerInput => (t % 2 === 0 ? flag("right") : flag("left"));
    const remoteOf = (t: number): PlayerInput => (t % 5 === 0 ? flag("jump") : emptyInput());
    const truthInputs: PlayerInput[][] = [];
    for (let t = 0; t < 80; t++) {
      truthInputs.push([localOf(t), remoteOf(t)]);
      c.predict(t, localOf(t));
      c.confirm(t, [localOf(t), remoteOf(t)]);
    }
    expect(c.confirmedTick).toBe(80);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(reference(truthInputs)));
  });

  it("resync hard-resets to a host snapshot and continues from it", () => {
    const c = makeController(0);
    // build a host snapshot at tick 5
    const host = createSim({ arena, tuning, players, seed: SEED });
    const inputs5: PlayerInput[][] = [];
    for (let t = 0; t < 5; t++) {
      const row = [flag("right"), flag("left")];
      inputs5.push(row);
      host.step(row);
    }
    const snap5 = host.snapshot();

    c.predict(0, flag("right")); // some divergent prediction first
    c.resync(snap5);
    expect(c.confirmedTick).toBe(5);
    expect(c.predictedTick).toBe(5);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(snap5));

    // continue past the resync and confirm convergence
    host.step([flag("down"), flag("down")]);
    c.predict(5, flag("down"));
    c.confirm(5, [flag("down"), flag("down")]);
    expect(JSON.stringify(c.snapshotConfirmed())).toBe(JSON.stringify(host.snapshot()));
  });
});
