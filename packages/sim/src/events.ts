export type KillCause = "arrow" | "stomp" | "bomb";

/**
 * Every externally meaningful occurrence in the sim is a SimEvent.
 * The shell renders/reacts off these; the eval pipeline computes
 * balance metrics off these. Payloads must stay JSON-serializable —
 * the determinism proof compares serialized logs byte-for-byte.
 */
import type { ArrowKind, ChestContents } from "./state";

export type SimEvent =
  | { tick: number; type: "round_started" }
  | { tick: number; type: "arrow_fired"; playerSlot: number; arrowId: number; kind: ArrowKind }
  | { tick: number; type: "arrow_stuck"; arrowId: number; x: number; y: number }
  | { tick: number; type: "arrow_exploded"; arrowId: number; x: number; y: number }
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
  | { tick: number; type: "match_ended"; winner: number; scores: number[] }
  | { tick: number; type: "chest_spawned"; chestId: number; x: number; y: number; contents: ChestContents }
  | { tick: number; type: "chest_opened"; chestId: number; slot: number; contents: ChestContents }
  | {
      tick: number;
      type: "booster_collected";
      boosterId: number;
      slot: number;
      contents: ChestContents;
    };
