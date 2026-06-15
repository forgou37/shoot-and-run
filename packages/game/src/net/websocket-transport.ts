/**
 * Browser WebSocket transport (spec 010, T10.3). The first concrete
 * implementation of the 008 `Transport` seam: it wraps a DOM `WebSocket` and
 * exchanges binary datagrams with the Host. It lives in `packages/game` — NOT
 * `packages/net` — precisely because it names the DOM `WebSocket`; the pure net
 * package stays headless (the `net-purity` cruiser rule forbids DOM there).
 *
 * Datagrams sent before the socket finishes opening are buffered and flushed on
 * `open`, so the caller can construct the transport and a `ClientSession` and
 * begin issuing inputs without awaiting the connection. WebSocket is reliable +
 * ordered (TCP); the rollback design tolerates loss/reorder but TCP head-of-line
 * blocking can hitch under loss — an accepted v1 caveat (unreliable WebRTC is 012).
 */
import type { Transport } from "@shoot-and-run/net";

export class WebSocketTransport implements Transport {
  readonly id: string;
  private readonly ws: WebSocket;
  private messageHandler: ((data: Uint8Array) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  /** Datagrams queued while the socket is still CONNECTING (own their bytes). */
  private readonly preOpen: ArrayBuffer[] = [];
  private closed = false;

  constructor(url: string, id = "client") {
    this.id = id;
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      for (const buf of this.preOpen) this.ws.send(buf);
      this.preOpen.length = 0;
    };
    this.ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) this.messageHandler?.(new Uint8Array(ev.data));
      // Text/blob frames are not part of the protocol — ignore.
    };
    this.ws.onclose = () => this.fireClose();
    // An error is always followed by close; route both through one close path.
    this.ws.onerror = () => this.fireClose();
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    // Copy into a fresh ArrayBuffer-backed view: the DOM `send` signature wants
    // an ArrayBuffer (not a SharedArrayBuffer-backed Uint8Array), and the copy
    // means a queued datagram owns its bytes even if the caller reuses the buffer.
    const buf = new ArrayBuffer(data.byteLength);
    new Uint8Array(buf).set(data);
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buf);
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.preOpen.push(buf);
    }
    // CLOSING/CLOSED: drop (the channel is gone).
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.ws.close();
  }

  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}
