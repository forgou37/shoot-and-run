import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { decodeMessage, encodeMessage, type Transport } from "@shoot-and-run/net";
import { emptyInput } from "@shoot-and-run/sim";
import { createWsTransportServer } from "./ws-transport-server";

/**
 * T10.4 / W2 — the `ws`→TransportServer adapter exchanges real NetMessage
 * datagrams with a real `ws` client over loopback TCP, both directions. The
 * BROWSER WebSocketTransport (packages/game) is exercised against this same
 * adapter by the two-tab e2e (T10.6); here we prove the server side over TCP.
 */
describe("ws TransportServer adapter (T10.4 / W2)", () => {
  it("round-trips datagrams with a real ws client over loopback TCP", async () => {
    const { server, wss } = createWsTransportServer({ port: 0, host: "127.0.0.1" });
    await new Promise<void>((resolve) => wss.once("listening", () => resolve()));
    const port = (wss.address() as AddressInfo).port;

    const serverTransportReady = new Promise<Transport>((resolve) => server.onConnection(resolve));
    const client = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    await new Promise<void>((resolve) => client.once("open", () => resolve()));
    const serverTransport = await serverTransportReady;

    // client -> server
    const inputMsg = { type: "input" as const, tick: 7, input: { ...emptyInput(), right: true, jump: true } };
    const gotByServer = new Promise<Uint8Array>((resolve) => serverTransport.onMessage(resolve));
    client.send(encodeMessage(inputMsg));
    expect(decodeMessage(await gotByServer)).toEqual(inputMsg);

    // server -> client
    const ackMsg = { type: "ack" as const, tick: 3, inputTick: 2 };
    const gotByClient = new Promise<Uint8Array>((resolve) =>
      client.once("message", (data: Buffer) => resolve(new Uint8Array(data)))
    );
    serverTransport.send(encodeMessage(ackMsg));
    expect(decodeMessage(await gotByClient)).toEqual(ackMsg);

    client.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
});
