/**
 * `ws` → TransportServer adapter. Implements the 008 `TransportServer` seam over
 * a Node `ws` WebSocketServer, yielding one `Transport` per inbound socket. This
 * is the only Node-/`ws`-specific transport code in the netcode stack — it lives
 * in the dedicated host (`packages/server`), NOT `packages/net` (which stays
 * headless). The same adapter would be swapped for a `workerd` WebSocket API if
 * the host ever graduates to a serverless edge; `HostRuntime` above it is
 * unchanged.
 *
 * Spec 010 (T10.4) created it in `scripts/dev-host`; spec 011 (T11.1) graduated
 * it into `packages/server` and added optional in-process TLS (`wss://`) for a
 * proxy-less deploy. The default path stays plain `ws` (TLS terminates at a
 * reverse proxy — the recommended VPS setup; see the deployment doc).
 */
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
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

export interface CreateWsServerOpts {
  /** Listen port (0 picks an ephemeral port — used by the adapter test). */
  port: number;
  /** Bind address; default = all interfaces. */
  host?: string;
  /** When set, terminate TLS in-process and serve `wss://` (PEM contents). */
  tls?: { cert: string; key: string };
}

export interface WsTransportServer {
  /** The 008 seam HostRuntime consumes. */
  server: TransportServer;
  /** The underlying ws server — for the adapter test (port/listening). */
  wss: WebSocketServer;
  /** Bound address once listening (port lookup for tests / logging). */
  address(): AddressInfo | string | null;
  /** Tear down the ws server and, in TLS mode, the underlying https server. */
  close(cb?: () => void): void;
}

export function createWsTransportServer(opts: CreateWsServerOpts): WsTransportServer {
  // Plain ws (TLS at a reverse proxy) is the default; direct TLS attaches the ws
  // server to an https.Server so browsers on the https Pages client can reach it.
  let httpsServer: HttpsServer | undefined;
  let wss: WebSocketServer;
  if (opts.tls) {
    httpsServer = createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key });
    wss = new WebSocketServer({ server: httpsServer });
    httpsServer.listen(opts.port, opts.host);
  } else {
    wss = new WebSocketServer({ port: opts.port, host: opts.host });
  }

  let connectionHandler: ((transport: Transport) => void) | null = null;
  let n = 0;

  wss.on("connection", (socket) => {
    connectionHandler?.(new WsTransport(`ws:${String(n++)}`, socket));
  });

  const close = (cb?: () => void): void => {
    wss.close(() => {
      if (httpsServer) httpsServer.close(() => cb?.());
      else cb?.();
    });
  };

  const server: TransportServer = {
    onConnection: (handler) => {
      connectionHandler = handler;
    },
    close: () => close()
  };

  return {
    server,
    wss,
    address: () => (httpsServer ? httpsServer.address() : wss.address()),
    close
  };
}
