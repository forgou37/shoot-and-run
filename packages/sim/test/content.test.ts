import { describe, expect, it } from "vitest";
import arena001 from "../../../content/arenas/arena-001.json";
import arena002 from "../../../content/arenas/arena-002.json";
import arena003 from "../../../content/arenas/arena-003.json";
import tuningJson from "../../../content/tuning.json";
import { parseArena } from "../src/arena";
import { parseTuning } from "../src/tuning";

/** Every file in content/ must validate (CLAUDE.md: content validated on load).
 *  Add new content files here as they land. */
describe("content files validate", () => {
  it("content/arenas/arena-001.json", () => {
    expect(() => parseArena(arena001)).not.toThrow();
  });

  it("content/arenas/arena-002.json", () => {
    expect(() => parseArena(arena002)).not.toThrow();
  });

  it("content/arenas/arena-003.json", () => {
    expect(() => parseArena(arena003)).not.toThrow();
  });

  it("content/tuning.json", () => {
    expect(() => parseTuning(tuningJson)).not.toThrow();
  });

  it("parseTuning rejects missing or non-numeric keys", () => {
    const { gravity: _gravity, ...missing } = tuningJson;
    expect(() => parseTuning(missing)).toThrow(/gravity must be a finite number/);
    expect(() => parseTuning({ ...tuningJson, runSpeed: "fast" })).toThrow(
      /runSpeed must be a finite number/
    );
    expect(() => parseTuning({ ...tuningJson, jumpCutFactor: 1.5 })).toThrow(
      /jumpCutFactor must be in \[0, 1\]/
    );
    expect(() => parseTuning({ ...tuningJson, startingArrows: 2.5 })).toThrow(
      /startingArrows must be a non-negative integer/
    );
  });
});
