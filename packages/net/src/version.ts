/**
 * Build/content version guard (spec 011, T11.2 / S4). In 010 the host and clients
 * shared one machine's `content/`, so a content mismatch was impossible. In 011
 * the GitHub-Pages client and the VPS host are deployed INDEPENDENTLY and can
 * drift — a stale cached client against a freshly-deployed host. A silent drift
 * desyncs the sim invisibly; this turns it into a loud, friendly refusal.
 *
 * The host stamps each `HelloMessage` with `computeContentVersion(arena, tuning)`;
 * the client computes the same over its own local content and rejects the session
 * (with `VersionMismatchError`) if they differ. The wire `PROTOCOL_VERSION` prefix
 * already rejects mismatched protocol builds at decode time — this adds the
 * orthogonal "same protocol, different pinned content" case.
 *
 * Pure/headless: imports only the sim's types + PROTOCOL_VERSION (no DOM, no
 * TextEncoder — the hash folds UTF-16 code units directly, like the codec's UTF-8).
 */
import { PROTOCOL_VERSION, type ArenaData, type Tuning } from "@shoot-and-run/sim";

/**
 * A stable 32-bit fingerprint of the session contract a host and client MUST
 * agree on: the wire protocol version plus the pinned arena and tuning. FNV-1a
 * over the canonical JSON, folding both bytes of each UTF-16 unit so non-ASCII
 * content still hashes deterministically. Same content on both peers ⇒ same
 * number; any drift ⇒ different number.
 */
export function computeContentVersion(arena: ArenaData, tuning: Tuning): number {
  const json = JSON.stringify({ p: PROTOCOL_VERSION, arena, tuning });
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
    h = Math.imul(h ^ (c >>> 8), 0x01000193);
  }
  return h >>> 0;
}

/** The host's pinned content differs from this client's — they cannot share a
 *  deterministic sim. Thrown/surfaced so the shell can tell the player to refresh. */
export class VersionMismatchError extends Error {
  constructor(
    readonly clientVersion: number,
    readonly hostVersion: number
  ) {
    super(
      `content version mismatch: host=${String(hostVersion)}, client=${String(clientVersion)} — ` +
        `the host is on a different build; refresh the page`
    );
    this.name = "VersionMismatchError";
  }
}
