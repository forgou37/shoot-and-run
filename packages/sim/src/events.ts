export type KillCause = "arrow" | "stomp";

/**
 * Every externally meaningful occurrence in the sim is a SimEvent.
 * The shell renders/reacts off these; the eval pipeline computes
 * balance metrics off these. Payloads must stay JSON-serializable —
 * the determinism proof compares serialized logs byte-for-byte.
 */
import type { ArrowKind } from "./state";

export type SimEvent =
  | { tick: number; type: "round_started" }
  | { tick: number; type: "arrow_fired"; playerSlot: number; arrowId: number; kind: ArrowKind }
  | { tick: number; type: "arrow_stuck"; arrowId: number; x: number; y: number }
  | { tick: number; type: "arrow_picked_up"; arrowId: number; playerSlot: number }
  | {
      tick: number;
      type: "player_killed";
      victim: number;
      killer: number;
      cause: KillCause;
      /** Victim position at death — used by shell FX and future kill heatmaps. */
      x: number;
      y: number;
    }
  | { tick: number; type: "round_ended"; winner: number | "draw" }
  | { tick: number; type: "match_ended"; winner: number; scores: number[] };
