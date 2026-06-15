/**
 * @shoot-and-run/net — host-authoritative rollback netcode (spec 008).
 *
 * Phase 008 (T8.6) added the transport seam + protocol/session TYPES; Phase 009
 * adds the headless session layer over an in-process loopback transport. Concrete
 * transports (WebSocket, WebRTC) arrive in 010+.
 *
 * Pure and headless: may import @shoot-and-run/sim and nothing else — never
 * Phaser or the DOM (enforced by the `net-purity` dependency-cruiser rule,
 * mirroring sim/bots). The dedicated host (packages/server) will be sim + net.
 */
export const NET_VERSION = "0.0.0";

export * from "./transport";
export * from "./protocol";
export * from "./session";
export * from "./loopback";
export * from "./codec";
export * from "./host";
export * from "./clock";
export * from "./rollback";
