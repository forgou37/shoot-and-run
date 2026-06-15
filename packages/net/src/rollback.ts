/**
 * Client-side prediction + rollback (spec 008, Phase 009 / T9.4). The client
 * runs two sims:
 *
 *   • confirmedSim — fed ONLY the host's authoritative inputs, in order. Because
 *     it replays the exact inputs the host stepped, on the same arena/tuning/
 *     players/seed, its state at tick T is byte-identical to the host's at T
 *     (determinism, spec 008). This is ground truth and never speculative.
 *   • predictedSim — runs ahead of confirmed: the local input immediately, and
 *     remote inputs guessed by repeat-last. On an authoritative message it either
 *     confirms cheaply (guess matched) or rolls back to the confirmed snapshot
 *     and re-simulates forward — so a visible correction happens ONLY when a
 *     remote input actually differed from the guess.
 *
 * `resync(snapshot)` hard-resets both sims to a host snapshot, healing gaps that
 * packet loss left in the authoritative stream (the host snapshots periodically).
 *
 * Pure/headless: no transport, no timers. The caller drives predict()/confirm()/
 * resync() from decoded messages and feeds local input each tick.
 */
import {
  createSim,
  createSimFromSnapshot,
  emptyInput,
  encodeInputByte,
  type ArenaData,
  type PlayerInput,
  type PlayerSlotConfig,
  type Sim,
  type SimSnapshot,
  type Tuning
} from "@shoot-and-run/sim";
import type { RollbackController, TickInputs } from "./session";

export interface RollbackControllerConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  seed: number;
  friendlyFire?: boolean;
  /** Which slot the local player controls (its input is known exactly). */
  localSlot: number;
  /** Max ticks the predicted sim may run ahead of confirmed (bounds rollback). */
  maxRollbackTicks: number;
}

export interface RollbackControllerHandle extends RollbackController {
  /** Authoritative (ground-truth) state at confirmedTick — equals the host's. */
  snapshotConfirmed(): SimSnapshot;
  /** Speculative state at predictedTick (what a renderer would show). */
  snapshotPredicted(): SimSnapshot;
}

function inputsEqual(a: readonly PlayerInput[], b: readonly PlayerInput[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (encodeInputByte(a[i]!) !== encodeInputByte(b[i]!)) return false;
  }
  return true;
}

export function createRollbackController(
  config: RollbackControllerConfig
): RollbackControllerHandle {
  const restoreConfig = {
    arena: config.arena,
    tuning: config.tuning,
    players: config.players,
    friendlyFire: config.friendlyFire
  };
  const playerCount = config.players.length;
  const localSlot = config.localSlot;
  const maxRollback = config.maxRollbackTicks;

  // Both sims start from the same deterministic tick-0 state as the host.
  let confirmedSim: Sim = createSim({
    arena: config.arena,
    tuning: config.tuning,
    players: config.players,
    seed: config.seed,
    friendlyFire: config.friendlyFire
  });
  let confirmedSnapshot: SimSnapshot = confirmedSim.snapshot();
  let predictedSim: Sim = createSimFromSnapshot(confirmedSnapshot, restoreConfig);

  let confirmedTick = 0;
  let predictedTick = 0;

  const localInputs = new Map<number, PlayerInput>();
  const authoritative = new Map<number, PlayerInput[]>();
  const predictedLog = new Map<number, PlayerInput[]>();
  /** Last authoritative input per slot — the repeat-last guess source. */
  let lastConfirmedRemote: PlayerInput[] = config.players.map(() => emptyInput());

  function resolveInputs(tick: number): PlayerInput[] {
    const auth = authoritative.get(tick);
    if (auth) return auth;
    const out: PlayerInput[] = [];
    for (let slot = 0; slot < playerCount; slot++) {
      if (slot === localSlot) out.push(localInputs.get(tick) ?? emptyInput());
      else out.push(lastConfirmedRemote[slot]!); // repeat-last
    }
    return out;
  }

  function resimFromConfirmed(): void {
    predictedSim = createSimFromSnapshot(confirmedSnapshot, restoreConfig);
    for (let t = confirmedTick; t < predictedTick; t++) {
      const ins = resolveInputs(t);
      predictedSim.step(ins);
      predictedLog.set(t, ins);
    }
  }

  return {
    get confirmedTick(): number {
      return confirmedTick;
    },
    get predictedTick(): number {
      return predictedTick;
    },

    predict(tick: number, input: PlayerInput): void {
      if (tick !== predictedTick) return; // must predict the next tick in order
      // Record the local input even when stalled at the rollback cap, so it is
      // never lost — it gets applied (and can be re-sent) once confirmation
      // catches up and prediction resumes.
      localInputs.set(tick, input);
      if (predictedTick - confirmedTick >= maxRollback) return; // stalled: don't out-run confirmation
      const ins = resolveInputs(tick);
      predictedSim.step(ins);
      predictedLog.set(tick, ins);
      predictedTick = tick + 1;
    },

    confirm(tick: number, inputs: TickInputs): boolean {
      if (tick < confirmedTick) return false; // stale / already authoritative
      authoritative.set(tick, inputs);

      // Apply every contiguous authoritative tick to the confirmed sim.
      let mispredicted = false;
      while (authoritative.has(confirmedTick)) {
        const auth = authoritative.get(confirmedTick)!;
        const used = predictedLog.get(confirmedTick);
        if (used && !inputsEqual(used, auth)) mispredicted = true;
        confirmedSim.step(auth);
        lastConfirmedRemote = auth.slice();
        localInputs.delete(confirmedTick);
        predictedLog.delete(confirmedTick);
        authoritative.delete(confirmedTick);
        confirmedTick++;
      }
      confirmedSnapshot = confirmedSim.snapshot();

      // Client was behind the authoritative stream — fast-forward prediction.
      if (confirmedTick > predictedTick) {
        predictedSim = createSimFromSnapshot(confirmedSnapshot, restoreConfig);
        predictedTick = confirmedTick;
        predictedLog.clear();
        return false;
      }

      // A guess was wrong for an already-predicted tick — roll back + re-sim.
      // Per the contract a correction happens iff a remote input differed from
      // the guess, which is exactly `mispredicted`; no need to deep-clone +
      // stringify the whole state twice on this hot path (which would also lean
      // on JSON's lossy number handling).
      if (mispredicted) {
        resimFromConfirmed();
        return true;
      }
      return false;
    },

    resync(snapshot: SimSnapshot): void {
      if (snapshot.state.tick <= confirmedTick) return; // not newer; ignore
      confirmedSim = createSimFromSnapshot(snapshot, restoreConfig);
      confirmedSnapshot = confirmedSim.snapshot();
      confirmedTick = snapshot.state.tick;
      predictedSim = createSimFromSnapshot(snapshot, restoreConfig);
      predictedTick = confirmedTick;
      // Keep the last-known authoritative remote inputs as the repeat-last guess
      // (consistent with prediction elsewhere) — right after a snapshot heal the
      // last held input is a better guess than blanking everyone to "released".
      for (const t of [...localInputs.keys()]) if (t < confirmedTick) localInputs.delete(t);
      for (const t of [...authoritative.keys()]) if (t < confirmedTick) authoritative.delete(t);
      predictedLog.clear();
    },

    snapshotConfirmed(): SimSnapshot {
      return confirmedSnapshot;
    },
    snapshotPredicted(): SimSnapshot {
      return predictedSim.snapshot();
    }
  };
}
