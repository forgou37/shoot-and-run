/**
 * Dedicated-host runtime (spec 011, T11.1). Wraps `createHostRuntime` (the pure
 * 010 connection/slot/handshake layer) with the two impure things a real host
 * needs: a `ws` `TransportServer` and a 60 Hz wall-clock loop. Everything game-
 * logical lives in `packages/sim`; everything network-logical in `packages/net`;
 * this is just the Node bootstrap that drives them.
 *
 * Reusable + transport-config-agnostic: `main.ts` reads env and calls this; tests
 * or a future entry could call it directly. The v1 start policy (wait for all
 * expected clients, then run from tick 0) and per-client slot assignment all live
 * in `HostRuntime` — `step()` is a no-op until every expected client connects.
 */
import { createHostRuntime, type HostRuntimeHandle } from "@shoot-and-run/net";
import { TICK_RATE, type ArenaData, type Tuning } from "@shoot-and-run/sim";
import { createWsTransportServer } from "./ws-transport-server";

export interface StartHostConfig {
  /** ws listen port. */
  port: number;
  /** Bind address; default = all interfaces. */
  host?: string;
  /** Players (= clients to wait for before starting from tick 0). */
  players: number;
  /** Session seed (must match across the session). */
  seed: number;
  arena: ArenaData;
  tuning: Tuning;
  /** Broadcast a full snapshot every this many committed ticks (>= 1). */
  snapshotIntervalTicks: number;
  /** Sent in each hello so clients load the matching local arena (default arena.name). */
  arenaId?: string;
  friendlyFire?: boolean;
  /** When set, serve `wss://` directly (PEM contents) instead of plain `ws`. */
  tls?: { cert: string; key: string };
  /** Fired once, the first tick the loop actually steps (all clients in). */
  onStarted?: () => void;
}

export interface RunningHost {
  /** The authoritative runtime (tick / ready / diagnostics). */
  runtime: HostRuntimeHandle;
  /** Stop the loop and tear down the ws (and https) server. */
  stop(cb?: () => void): void;
}

export function startHost(config: StartHostConfig): RunningHost {
  const ws = createWsTransportServer({
    port: config.port,
    host: config.host,
    tls: config.tls
  });

  const runtime = createHostRuntime({
    server: ws.server,
    arena: config.arena,
    tuning: config.tuning,
    players: Array.from({ length: config.players }, (_, i) => ({ slot: i })),
    seed: config.seed,
    friendlyFire: config.friendlyFire,
    snapshotIntervalTicks: config.snapshotIntervalTicks,
    arenaId: config.arenaId ?? config.arena.name,
    expectedClients: config.players
  });

  let started = false;
  const interval = setInterval(() => {
    const stepped = runtime.step(); // no-op until all expected clients connect
    if (stepped && !started) {
      started = true;
      config.onStarted?.();
    }
  }, 1000 / TICK_RATE);

  return {
    runtime,
    stop(cb?: () => void): void {
      clearInterval(interval);
      ws.close(cb);
    }
  };
}
