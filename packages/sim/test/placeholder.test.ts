import { describe, expect, it } from "vitest";
import { SIM_VERSION } from "../src/index";

describe("sim package", () => {
  it("is importable headless in Node", () => {
    expect(SIM_VERSION).toBe("0.0.0");
  });
});
