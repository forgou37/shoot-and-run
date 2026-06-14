import { describe, expect, it } from "vitest";
import botsJson from "../../../content/bots.json";
import { botDifficulty, parseBotConfig } from "../src/config";

describe("parseBotConfig", () => {
  it("accepts the shipped content/bots.json with easy/normal/hard", () => {
    const config = parseBotConfig(botsJson);
    expect(Object.keys(config.difficulties).sort()).toEqual(["easy", "hard", "normal"]);
    expect(config.difficulties.hard!.reactionDelayTicks).toBeLessThan(
      config.difficulties.easy!.reactionDelayTicks
    );
  });

  it("looks up a preset by name and throws on an unknown one", () => {
    const config = parseBotConfig(botsJson);
    expect(botDifficulty(config, "normal").aimTolerance).toBe(7);
    expect(() => botDifficulty(config, "nightmare")).toThrow(/unknown difficulty/);
  });

  const good = {
    reactionDelayTicks: 4,
    aimTolerance: 6,
    aimErrorChance: 0.2,
    dodgeChance: 0.5,
    dashChance: 0.3
  };
  const bad: [string, unknown][] = [
    ["not an object", 42],
    ["no difficulties", {}],
    ["empty difficulties", { difficulties: {} }],
    ["non-integer reaction", { difficulties: { x: { ...good, reactionDelayTicks: 2.5 } } }],
    ["zero reaction", { difficulties: { x: { ...good, reactionDelayTicks: 0 } } }],
    ["chance out of range", { difficulties: { x: { ...good, dodgeChance: 1.5 } } }],
    ["negative chance", { difficulties: { x: { ...good, aimErrorChance: -0.1 } } }],
    ["non-positive tolerance", { difficulties: { x: { ...good, aimTolerance: 0 } } }],
    ["missing knob", { difficulties: { x: { reactionDelayTicks: 4, aimTolerance: 6 } } }],
    ["non-finite", { difficulties: { x: { ...good, dashChance: Number.NaN } } }]
  ];
  it.each(bad)("rejects malformed config: %s", (_label, data) => {
    expect(() => parseBotConfig(data)).toThrow(/^bots:/);
  });
});
