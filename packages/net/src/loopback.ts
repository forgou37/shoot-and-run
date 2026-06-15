/**
 * In-process loopback transport (spec 008, Phase 009 / T9.0). Implements the 008
 * Transport/TransportServer seam entirely in memory so the session layer can be
 * exercised headlessly with realistic-but-deterministic network conditions:
 * configurable one-way latency, jitter (reordering), and packet loss.
 *
 * It is driven by an explicit virtual clock — no wall-time — and all randomness
 * comes from a seeded mulberry32 (the sim's PRNG, reused as a plain utility, NOT
 * a sim instance's stream). Same seed + same sequence of sends => identical
 * delivery schedule, so the whole net test bed is reproducible.
 *
 * Usage:
 *   const net = new LoopbackNetwork({ seed, latencyTicks, jitterTicks, lossRate });
 *   net.server.onConnection((hostSide) => { ...host accepts... });
 *   const clientSide = net.connect("c0");   // fires onConnection(hostSide)
 *   ...each tick: net.advance(tick) delivers everything due at/<= tick...
 */
import { createRng, type Rng } from "@shoot-and-run/sim";
import type { Transport, TransportServer } from "./transport";

export interface LoopbackOptions {
  /** Seed for the jitter/loss PRNG — fixes the delivery schedule. */
  seed: number;
  /** Base one-way delay in ticks (default 0 = same-tick-eligible, i.e. next tick). */
  latencyTicks?: number;
  /** Symmetric jitter range in ticks: actual delay = latency + U[-jitter, +jitter]. */
  jitterTicks?: number;
  /** Drop probability per datagram, 0..1 (default 0). */
  lossRate?: number;
}

interface Pending {
  deliverTick: number;
  seq: number;
  to: LoopbackEndpoint;
  data: Uint8Array;
}

class LoopbackEndpoint implements Transport {
  readonly id: string;
  peer!: LoopbackEndpoint;
  closed = false;
  private messageHandler: ((data: Uint8Array) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(
    id: string,
    private readonly net: LoopbackNetwork
  ) {
    this.id = id;
  }

  send(data: Uint8Array): void {
    if (this.closed) return;
    this.net._enqueue(this.peer, data);
  }

  onMessage(handler: (data: Uint8Array) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.net._close(this);
  }

  /** @internal — invoked by the network when a datagram is delivered. */
  _deliver(data: Uint8Array): void {
    if (!this.closed) this.messageHandler?.(data);
  }

  /** @internal — invoked by the network when the channel closes. */
  _fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}

export class LoopbackNetwork {
  private readonly rng: Rng;
  private readonly latency: number;
  private readonly jitter: number;
  private readonly loss: number;

  private readonly queue: Pending[] = [];
  private seq = 0;
  private nowTick = 0;
  private connectionHandler: ((transport: Transport) => void) | null = null;
  /** Diagnostics: total datagrams dropped to packet loss. */
  dropped = 0;

  constructor(opts: LoopbackOptions) {
    this.rng = createRng(opts.seed);
    this.latency = opts.latencyTicks ?? 0;
    this.jitter = opts.jitterTicks ?? 0;
    this.loss = opts.lossRate ?? 0;
  }

  /** The current virtual tick (last value passed to advance). */
  get now(): number {
    return this.nowTick;
  }

  /** Host-side listener. The host registers onConnection before clients connect. */
  get server(): TransportServer {
    return {
      onConnection: (handler) => {
        this.connectionHandler = handler;
      },
      close: () => this.close()
    };
  }

  /**
   * Dial in a client: creates a linked endpoint pair, fires the server's
   * onConnection with the host-side Transport, and returns the client-side one.
   */
  connect(clientId: string): Transport {
    const client = new LoopbackEndpoint(clientId, this);
    const host = new LoopbackEndpoint(`host:${clientId}`, this);
    client.peer = host;
    host.peer = client;
    this.connectionHandler?.(host);
    return client;
  }

  /** Deliver every datagram whose delivery tick is <= toTick, in a deterministic
   *  order (by deliver tick, then send order). Sets the virtual clock to toTick. */
  advance(toTick: number): void {
    this.nowTick = toTick;
    const due: Pending[] = [];
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i]!.deliverTick <= toTick) {
        due.push(this.queue[i]!);
        this.queue.splice(i, 1);
      }
    }
    due.sort((a, b) => a.deliverTick - b.deliverTick || a.seq - b.seq);
    for (const m of due) m.to._deliver(m.data);
  }

  /** Tear down all connections. */
  close(): void {
    this.queue.length = 0;
  }

  /** @internal — enqueue a datagram from an endpoint to its peer. */
  _enqueue(to: LoopbackEndpoint, data: Uint8Array): void {
    if (to.closed) return;
    if (this.loss > 0 && this.rng.next() < this.loss) {
      this.dropped++;
      return;
    }
    let delay = this.latency;
    if (this.jitter > 0) delay += this.rng.nextInt(this.jitter * 2 + 1) - this.jitter;
    // A datagram never arrives in the past or same tick it was sent.
    const deliverTick = Math.max(this.nowTick + 1, this.nowTick + delay);
    this.queue.push({ deliverTick, seq: this.seq++, to, data: data.slice() });
  }

  /** @internal — close one endpoint and notify its peer. */
  _close(endpoint: LoopbackEndpoint): void {
    const peer = endpoint.peer;
    endpoint._fireClose();
    peer?._fireClose();
  }
}
