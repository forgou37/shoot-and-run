/**
 * Net session parameters (spec 008, Phase 009 / T9.6). These are tunables, so by
 * hard rule 3 they live in content — a shell/net-only `net` block in
 * content/tuning.json, alongside the sim-ignored `juice`/`input`/`ui` blocks.
 * The sim's parseTuning strips to its own key list, so the `net` block never
 * reaches the sim and the determinism artifacts are untouched.
 *
 * `parseNetParams` validates that block; pass it the parsed tuning object.
 */
import type { PredictionParams } from "./session";

export interface NetParams extends PredictionParams {
  /**
   * Depth of the client inbound jitter buffer (ticks). RESERVED — not yet
   * consumed: the rollback controller already tolerates reordering (it buffers
   * out-of-order authoritative ticks and applies them when contiguous), so an
   * explicit jitter buffer is only wired when the real transport lands (spec
   * 010). Validated here so the knob's contract is fixed up front.
   */
  jitterBufferTicks: number;
  /**
   * Max concurrent spectators the host accepts (spec 013, T13.2). Spectators
   * receive the authoritative stream but take no slot and never gate the start;
   * the cap also bounds fan-out / connection load on an open `wss://`. 0 disables
   * spectating. Host-side only — the sim and the prediction client ignore it.
   */
  maxSpectators: number;
}

const NET_KEYS: readonly (keyof NetParams)[] = [
  "inputDelayTicks",
  "snapshotIntervalTicks",
  "maxRollbackTicks",
  "jitterBufferTicks",
  "maxSpectators"
];

/** Validate the `net` block of a parsed content/tuning.json object. */
export function parseNetParams(tuning: unknown): NetParams {
  if (typeof tuning !== "object" || tuning === null) {
    throw new Error("net params: expected the tuning object");
  }
  const net = (tuning as Record<string, unknown>)["net"];
  if (typeof net !== "object" || net === null || Array.isArray(net)) {
    throw new Error("net params: tuning.net must be an object");
  }
  const obj = net as Record<string, unknown>;
  for (const key of NET_KEYS) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(`net params: ${key} must be a non-negative integer`);
    }
  }
  const p = obj as unknown as NetParams;
  if (p.snapshotIntervalTicks < 1) throw new Error("net params: snapshotIntervalTicks must be >= 1");
  if (p.maxRollbackTicks < 1) throw new Error("net params: maxRollbackTicks must be >= 1");
  return NET_KEYS.reduce((acc, key) => {
    acc[key] = p[key];
    return acc;
  }, {} as NetParams);
}
