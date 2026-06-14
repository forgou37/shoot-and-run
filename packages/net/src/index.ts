/**
 * @shoot-and-run/net — host-authoritative rollback netcode (spec 008).
 *
 * SKELETON (Phase 008, T8.6): the transport seam + protocol/session TYPES only,
 * no implementation. The session/prediction/rollback loop lands in spec 009 and
 * concrete transports (WebSocket, WebRTC) in 010+.
 *
 * Pure and headless: may import @shoot-and-run/sim and nothing else — never
 * Phaser or the DOM (enforced by the `net-purity` dependency-cruiser rule,
 * mirroring sim/bots). The dedicated host (packages/server) will be sim + net.
 */
export const NET_VERSION = "0.0.0";

export * from "./transport";
export * from "./protocol";
export * from "./session";
