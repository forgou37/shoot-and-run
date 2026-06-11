import { describe, expect, it } from "vitest";
import tuningJson from "../../../content/tuning.json";
import { parseJuice } from "../src/juice";

describe("parseJuice", () => {
  it("accepts the juice block in content/tuning.json", () => {
    const juice = parseJuice(tuningJson);
    expect(juice.hitstopMs).toBeGreaterThan(0);
    expect(juice.killBurstParticles).toBeGreaterThan(0);
  });

  it("rejects a missing block and bad values", () => {
    expect(() => parseJuice({})).toThrow(/juice block missing/);
    expect(() =>
      parseJuice({ juice: { ...((tuningJson as { juice: object }).juice), hitstopMs: -1 } })
    ).toThrow(/juice.hitstopMs/);
  });
});
