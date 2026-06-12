/** Shell-side game-feel effects config — the `juice` block of
 *  content/tuning.json (hard rule 3: one tuning file). The sim never sees
 *  these; they drive hitstop, camera shake, and particles only. */

const JUICE_KEYS = [
  "hitstopMs",
  "shakeDurationMs",
  "shakeMagnitudePx",
  "killBurstParticles",
  "stickPuffParticles",
  "bombBurstParticles",
  "invisibilityOpacity"
] as const;

export type JuiceConfig = Record<(typeof JUICE_KEYS)[number], number>;

export function parseJuice(tuningData: unknown): JuiceConfig {
  if (typeof tuningData !== "object" || tuningData === null) {
    throw new Error("tuning: expected an object");
  }
  const juice = (tuningData as Record<string, unknown>)["juice"];
  if (typeof juice !== "object" || juice === null) {
    throw new Error("tuning: juice block missing");
  }
  const obj = juice as Record<string, unknown>;
  const out = {} as Record<(typeof JUICE_KEYS)[number], number>;
  for (const key of JUICE_KEYS) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`tuning: juice.${key} must be a non-negative finite number`);
    }
    out[key] = value;
  }
  return out;
}
