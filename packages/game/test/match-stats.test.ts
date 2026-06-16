import { describe, expect, it } from "vitest";
import type { SimEvent } from "@shoot-and-run/sim";
import awardsJson from "../../../content/awards.json";
import {
  assignAwards,
  foldMatchStats,
  parseAwards,
  type PlayerMeta
} from "../src/match-stats";

const PLAYERS: PlayerMeta[] = [
  { slot: 0, name: "P0", color: "#f00", team: null },
  { slot: 1, name: "P1", color: "#0f0", team: null }
];

/** Convenience: a tally lookup that throws if the slot is missing. */
function tally(events: SimEvent[], slot: number) {
  const t = foldMatchStats(events, PLAYERS).bySlot.get(slot);
  if (!t) throw new Error(`no tally for slot ${String(slot)}`);
  return t;
}

describe("foldMatchStats", () => {
  it("counts jumps (all kinds) and wall jumps separately", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_jumped", slot: 0, kind: "ground" },
      { tick: 2, type: "player_jumped", slot: 0, kind: "wall" },
      { tick: 3, type: "player_jumped", slot: 0, kind: "flap" },
      { tick: 4, type: "player_jumped", slot: 1, kind: "wall" }
    ];
    expect(tally(ev, 0)).toMatchObject({ jumps: 3, wallJumps: 1 });
    expect(tally(ev, 1)).toMatchObject({ jumps: 1, wallJumps: 1 });
  });

  it("counts dashes, fires and pickups by slot", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_dashed", slot: 1 },
      { tick: 2, type: "arrow_fired", playerSlot: 0, arrowId: 1, kind: "normal" },
      { tick: 3, type: "arrow_fired", playerSlot: 0, arrowId: 2, kind: "bomb" },
      { tick: 4, type: "arrow_picked_up", arrowId: 1, playerSlot: 0 }
    ];
    expect(tally(ev, 0)).toMatchObject({ arrowsFired: 2, arrowsPickedUp: 1, dashes: 0 });
    expect(tally(ev, 1)).toMatchObject({ dashes: 1, arrowsFired: 0 });
  });

  it("credits kills by cause, counts deaths, and excludes self-kills from credit", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_killed", victim: 1, killer: 0, cause: "arrow", x: 0, y: 0 },
      { tick: 2, type: "player_killed", victim: 1, killer: 0, cause: "stomp", x: 0, y: 0 },
      { tick: 3, type: "player_killed", victim: 0, killer: 0, cause: "bomb", x: 0, y: 0 } // self-kill
    ];
    expect(tally(ev, 0)).toMatchObject({ arrowKills: 1, stompKills: 1, bombKills: 0, deaths: 1 });
    expect(tally(ev, 1)).toMatchObject({ deaths: 2 });
  });

  it("awards first blood to the first creditable killer only", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_killed", victim: 1, killer: 0, cause: "arrow", x: 0, y: 0 },
      { tick: 2, type: "player_killed", victim: 0, killer: 1, cause: "arrow", x: 0, y: 0 }
    ];
    expect(tally(ev, 0).firstBlood).toBe(1);
    expect(tally(ev, 1).firstBlood).toBe(0);
  });

  it("a self-kill first closes first-blood eligibility (nobody gets it)", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_killed", victim: 0, killer: 0, cause: "bomb", x: 0, y: 0 },
      { tick: 2, type: "player_killed", victim: 1, killer: 0, cause: "arrow", x: 0, y: 0 }
    ];
    expect(tally(ev, 0).firstBlood).toBe(0);
    expect(tally(ev, 1).firstBlood).toBe(0);
  });

  it("counts a round survived for everyone not killed that round", () => {
    const ev: SimEvent[] = [
      { tick: 0, type: "round_started" },
      { tick: 5, type: "player_killed", victim: 1, killer: 0, cause: "arrow", x: 0, y: 0 },
      { tick: 6, type: "round_ended", winner: 0 },
      { tick: 7, type: "round_started" },
      { tick: 9, type: "player_killed", victim: 0, killer: 1, cause: "arrow", x: 0, y: 0 },
      { tick: 10, type: "round_ended", winner: 1 }
    ];
    expect(tally(ev, 0).roundsSurvived).toBe(1); // survived round 1, died round 2
    expect(tally(ev, 1).roundsSurvived).toBe(1); // died round 1, survived round 2
  });

  it("tallies boosters, chests and shields by slot", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "chest_opened", chestId: 1, slot: 0, contents: "bomb" },
      { tick: 2, type: "booster_collected", boosterId: 1, slot: 0, contents: "flight" },
      { tick: 3, type: "shield_blocked", slot: 1 }
    ];
    expect(tally(ev, 0)).toMatchObject({ chestsOpened: 1, boostersCollected: 1 });
    expect(tally(ev, 1).shieldsBlocked).toBe(1);
  });

  it("ignores events for unknown slots", () => {
    const ev: SimEvent[] = [{ tick: 1, type: "player_dashed", slot: 9 }];
    const stats = foldMatchStats(ev, PLAYERS);
    expect(stats.bySlot.has(9)).toBe(false);
    expect(tally(ev, 0).dashes).toBe(0);
  });
});

describe("assignAwards (superlative-only)", () => {
  const catalog = {
    awards: [
      { id: "super-jumper", title: "Super Jumper", stat: "jumps" as const },
      { id: "deadeye", title: "Deadeye", stat: "arrowKills" as const }
    ]
  };

  it("gives each award to the single highest tally", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_jumped", slot: 1, kind: "ground" },
      { tick: 2, type: "player_jumped", slot: 1, kind: "ground" },
      { tick: 3, type: "player_jumped", slot: 0, kind: "ground" },
      { tick: 4, type: "player_killed", victim: 1, killer: 0, cause: "arrow", x: 0, y: 0 }
    ];
    const awards = assignAwards(foldMatchStats(ev, PLAYERS), catalog);
    expect(awards.find((a) => a.id === "super-jumper")).toMatchObject({ slot: 1, value: 2 });
    expect(awards.find((a) => a.id === "deadeye")).toMatchObject({ slot: 0, value: 1 });
  });

  it("breaks ties by the lowest slot", () => {
    const ev: SimEvent[] = [
      { tick: 1, type: "player_jumped", slot: 1, kind: "ground" },
      { tick: 2, type: "player_jumped", slot: 0, kind: "ground" }
    ];
    const awards = assignAwards(foldMatchStats(ev, PLAYERS), catalog);
    expect(awards.find((a) => a.id === "super-jumper")).toMatchObject({ slot: 0, value: 1 });
  });

  it("drops an award nobody earned (all-zero)", () => {
    const ev: SimEvent[] = [{ tick: 1, type: "player_jumped", slot: 0, kind: "ground" }];
    const awards = assignAwards(foldMatchStats(ev, PLAYERS), catalog);
    expect(awards.some((a) => a.id === "super-jumper")).toBe(true);
    expect(awards.some((a) => a.id === "deadeye")).toBe(false); // no kills
  });
});

describe("parseAwards", () => {
  it("accepts the shipped content/awards.json", () => {
    const catalog = parseAwards(awardsJson);
    expect(catalog.awards.length).toBeGreaterThan(0);
    expect(catalog.awards.every((a) => a.id && a.title && a.stat)).toBe(true);
  });

  it("rejects an unknown stat, duplicate id, and bad shape", () => {
    expect(() => parseAwards({ awards: [{ id: "x", title: "X", stat: "nope" }] })).toThrow(/stat must be one of/);
    expect(() =>
      parseAwards({
        awards: [
          { id: "dup", title: "A", stat: "jumps" },
          { id: "dup", title: "B", stat: "dashes" }
        ]
      })
    ).toThrow(/duplicate id/);
    expect(() => parseAwards({})).toThrow(/'awards' must be an array/);
    expect(() => parseAwards({ awards: [{ id: "", title: "X", stat: "jumps" }] })).toThrow(/id must be/);
  });
});
