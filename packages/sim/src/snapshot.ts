/**
 * Snapshot / restore (spec 008, T8.2). A snapshot is a deep, JSON-serializable
 * VALUE — it owns no references into the live sim — capturing everything needed
 * to resume bit-exactly: the SimState, the RNG's internal state, and the
 * entity-id counter (which lives outside SimState as a closure). The init
 * constants (arena/tuning/players/friendlyFire) are NOT stored: they are the
 * session contract and are supplied to createSimFromSnapshot by the caller.
 *
 * This is the substrate for client-side prediction + rollback re-simulation:
 * snapshot at the last confirmed tick, then re-step the input tail.
 */
import type { SimState } from "./state";

export interface SimSnapshot {
  /** SIM_VERSION at capture time, for cross-version mismatch detection. */
  version: string;
  /** Deep clone of the readable sim state. */
  state: SimState;
  /** The RNG's internal state (one uint32) — see Rng.getState(). */
  rngState: number;
  /** The entity-id allocator's next value. */
  nextEntityId: number;
}

/**
 * Structural deep clone of plain JSON-like data (objects, arrays, primitives) —
 * the exact shape of SimState (no classes, Maps, functions, or Dates). Written
 * by hand because the sim's tsconfig has no DOM lib, so `structuredClone` is not
 * available here; a JSON round-trip is rejected because it would coerce `-0`,
 * `NaN`, and `Infinity`, any of which could perturb the deterministic re-sim.
 * Primitives are returned as-is, so their bit pattern is preserved exactly.
 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = deepClone(value[i]);
    return out as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    out[key] = deepClone((value as Record<string, unknown>)[key]);
  }
  return out as T;
}
