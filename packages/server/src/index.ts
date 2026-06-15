/**
 * @shoot-and-run/server — the dedicated host: `@shoot-and-run/sim` +
 * `@shoot-and-run/net` + a Node `ws` transport and wall-clock loop (spec 011).
 *
 * A headless Node process — never imports Phaser or `packages/game` (enforced by
 * the `server-purity` dependency-cruiser rule). The CLI entry is `src/main.ts`
 * (`npm run dev:host` / `npm run start:host`); this barrel exposes the pieces for
 * programmatic use and tests.
 */
export { createWsTransportServer } from "./ws-transport-server";
export type { CreateWsServerOpts, WsTransportServer } from "./ws-transport-server";
export { startHost } from "./start";
export type { RunningHost, StartHostConfig } from "./start";
