import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import { ARENA_ROWS, parseArena } from "../src/arena";
import { TEST_ARENA } from "./fixtures";

/** Deep-clone arena-001 and apply a mutation, for malformed-fixture cases. */
function mutated(mutate: (a: { name: string; tiles: string[]; spawns: { x: number; y: number }[] }) => void) {
  const clone = JSON.parse(JSON.stringify(arena001)) as {
    name: string;
    tiles: string[];
    spawns: { x: number; y: number }[];
  };
  mutate(clone);
  return clone;
}

describe("parseArena", () => {
  it("accepts content/arenas/arena-001.json", () => {
    const arena = parseArena(arena001);
    expect(arena.name).toBe("crossfire");
    expect(arena.tiles).toHaveLength(ARENA_ROWS);
    expect(arena.spawns).toHaveLength(4);
  });

  it("accepts the test fixture arena", () => {
    expect(() => parseArena(TEST_ARENA)).not.toThrow();
  });

  it("rejects wrong row count", () => {
    const bad = mutated((a) => a.tiles.pop());
    expect(() => parseArena(bad)).toThrow(/expected 15 tile rows, got 14/);
  });

  it("rejects wrong row length", () => {
    const bad = mutated((a) => {
      a.tiles[3] = a.tiles[3]!.slice(0, 19);
    });
    expect(() => parseArena(bad)).toThrow(/row 3 must be 20 chars, got 19/);
  });

  it("rejects invalid tile characters", () => {
    const bad = mutated((a) => {
      a.tiles[5] = "..X" + a.tiles[5]!.slice(3);
    });
    expect(() => parseArena(bad)).toThrow(/row 5 col 2 has invalid char "X"/);
  });

  it("rejects too few spawns", () => {
    const bad = mutated((a) => {
      a.spawns = a.spawns.slice(0, 3);
    });
    expect(() => parseArena(bad)).toThrow(/at least 4 spawns required, got 3/);
  });

  it("rejects a spawn inside a solid tile", () => {
    const bad = mutated((a) => {
      a.spawns[0] = { x: 64, y: 72 }; // inside the row-4 platform
    });
    expect(() => parseArena(bad)).toThrow(/spawn 0 at \(64,72\) overlaps a solid tile/);
  });

  it("rejects a floating spawn with no ground below", () => {
    const bad = mutated((a) => {
      a.spawns[0] = { x: 160, y: 16 }; // open air, nothing within tolerance below
    });
    expect(() => parseArena(bad)).toThrow(/spawn 0 at \(160,16\) is not above ground/);
  });

  it("rejects a spawn whose hitbox crosses the arena edge", () => {
    const bad = mutated((a) => {
      a.spawns[0] = { x: 4, y: 152 };
    });
    expect(() => parseArena(bad)).toThrow(/places the player hitbox outside the arena/);
  });

  it("rejects non-object input", () => {
    expect(() => parseArena(null)).toThrow(/expected an object/);
    expect(() => parseArena([])).toThrow(/expected an object/);
    expect(() => parseArena("nope")).toThrow(/expected an object/);
  });
});
