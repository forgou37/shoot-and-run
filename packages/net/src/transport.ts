/**
 * Transport seam (spec 008, T8.6) — INTERFACE ONLY, no implementation. The
 * session/prediction layer (spec 009) is written against this seam so it never
 * names a concrete transport. Concrete transports live outside packages/net:
 * a WebSocket-to-Durable-Object adapter for the dedicated host (010) and a
 * WebRTC DataChannel for player-hosting (012). The star topology means a client
 * holds exactly one Transport (to the Host); the Host holds one per client.
 *
 * Datagrams may be lost and reordered — the rollback design tolerates both, so
 * implementations are NOT required to be reliable or ordered.
 */
export interface Transport {
  /** Stable id for this connection, assigned by the Host. */
  readonly id: string;
  /** Send one datagram to the peer. */
  send(data: Uint8Array): void;
  /** Register the sole inbound-datagram handler. */
  onMessage(handler: (data: Uint8Array) => void): void;
  /** Register the close handler (peer gone / channel dropped). */
  onClose(handler: () => void): void;
  /** Tear the channel down. */
  close(): void;
}

/**
 * Host-side listener that yields a Transport per inbound client connection
 * (dedicated server, 010+). Interface only.
 */
export interface TransportServer {
  /** Called once per accepted client connection. */
  onConnection(handler: (transport: Transport) => void): void;
  /** Stop accepting and close all connections. */
  close(): void;
}
