import { describe, expect, it } from "vitest";
import tuningJson from "../../../content/tuning.json";
import { parseNetParams } from "../src/params";

describe("net params (T9.6 / M7)", () => {
  it("loads the net block from content/tuning.json", () => {
    const params = parseNetParams(tuningJson);
    expect(params).toEqual({
      inputDelayTicks: 3,
      snapshotIntervalTicks: 30,
      maxRollbackTicks: 120,
      jitterBufferTicks: 4,
      maxSpectators: 4,
      reconnectGraceTicks: 600,
      reconnectAttempts: 5,
      reconnectBackoffTicks: 45
    });
  });

  it("rejects a missing net block", () => {
    expect(() => parseNetParams({})).toThrow(/tuning.net must be an object/);
  });

  it("rejects non-integer or negative values", () => {
    const base = tuningJson.net;
    expect(() => parseNetParams({ net: { ...base, inputDelayTicks: 1.5 } })).toThrow(
      /inputDelayTicks must be a non-negative integer/
    );
    expect(() => parseNetParams({ net: { ...base, maxRollbackTicks: -1 } })).toThrow(
      /maxRollbackTicks must be a non-negative integer/
    );
  });

  it("rejects a zero snapshot interval", () => {
    const base = tuningJson.net;
    expect(() => parseNetParams({ net: { ...base, snapshotIntervalTicks: 0 } })).toThrow(
      /snapshotIntervalTicks must be >= 1/
    );
  });
});
