/**
 * `ws` → TransportServer adapter (spec 010, T10.4). Implements the 008
 * `TransportServer` seam over a Node `ws` WebSocketServer, yielding one
 * `Transport` per inbound socket. This is the only Node-/`ws`-specific code in
 * the netcode stack — it lives in the dev host, NOT `packages/net` (which stays
 * headless). When the dedicated host graduates to a Cloudflare Durable Object
 * (spec 011), this adapter is what gets swapped for the `workerd` WebSocket API;
 * `HostRuntime` above it is unchanged.
 */
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { Transport, TransportServer } from "@shoot-and-run/net";

/** Normalize whatever `ws` hands us (Buffer | ArrayBuffer | Buffer[]) to bytes. */
function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data as Buffer); // Buffer → copy (decouples from ws's pool)
}

class WsTransport implements Transport {
  private messageHandler: ((data: Uint8Array) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(
    readonly id: string,
    private readonly socket: WebSocket
  ) {
    socket.binaryType = "nodebuffer";
    socket.on("message", (data: RawData) => this.messageHandler?.(toUint8(data)));
    socket.on("close", () => this.closeHandler?.());
    socket.on("error", () => this.closeHandler?.()); // always followed by close
  }

  send(data: Uint8Array): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(data);
  }
  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  close(): void {
    this.socket.close();
  }
}

export interface WsTransportServer {
  /** The 008 seam HostRuntime consumes. */
  server: TransportServer;
  /** The underlying server — for the test (port/listening) and shutdown. */
  wss: WebSocketServer;
}

export function createWsTransportServer(opts: { port: number; host?: string }): WsTransportServer {
  const wss = new WebSocketServer({ port: opts.port, host: opts.host });
  let connectionHandler: ((transport: Transport) => void) | null = null;
  let n = 0;

  wss.on("connection", (socket) => {
    connectionHandler?.(new WsTransport(`ws:${String(n++)}`, socket));
  });

  const server: TransportServer = {
    onConnection: (handler) => {
      connectionHandler = handler;
    },
    close: () => wss.close()
  };

  return { server, wss };
}
