/**
 * @shoot-and-run/bots — heuristic AI archers (spec 004).
 *
 * Pure and headless: imports only @shoot-and-run/sim (types + helpers), never
 * Phaser or the DOM (enforced by the `bots-purity` dependency-cruiser rule).
 * A bot is a `(state, slot, ctx) -> PlayerInput` policy; the shell wraps it in a
 * BotDevice, and the future eval pipeline (spec 005) calls it directly headless.
 */
export const BOTS_VERSION = "0.0.0";

export * from "./types";
export { botDifficulty, parseBotConfig, parseBotDifficulty, type BotConfig } from "./config";
export { botSeed, botTick, createBotMemory, makeBot, type MakeBotOptions } from "./bot";
