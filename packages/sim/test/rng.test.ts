import { describe, expect, it } from "vitest";
import { createRng } from "../src/rng";

describe("mulberry32 rng", () => {
  it("same seed produces the same sequence", () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("next() stays in [0, 1) and nextInt stays in [0, max)", () => {
    const rng = createRng(0xc0ffee);
    for (let i = 0; i < 1000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      const n = rng.nextInt(7);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(7);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  // T8.1 / N4 — getState/setState capture and restore the full stream position.
  it("captured state restores an identical onward stream", () => {
    const a = createRng(0xc0ffee);
    for (let i = 0; i < 37; i++) a.next(); // advance M times
    const saved = a.getState();

    const restored = createRng(0); // any seed; setState overwrites it
    restored.setState(saved);

    const tailA = Array.from({ length: 50 }, () => a.next());
    const tailB = Array.from({ length: 50 }, () => restored.next());
    expect(tailB).toEqual(tailA);
  });

  it("setState fully overrides the seed, so two rngs converge from that point", () => {
    const a = createRng(111);
    const b = createRng(999);
    a.next();
    a.next();
    b.setState(a.getState());
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(
      Array.from({ length: 20 }, () => a.next())
    );
  });

  it("getState/setState do not alter the seed→stream mapping (golden-log safe)", () => {
    // The first draws after a plain createRng must be unchanged by the new API:
    // capturing state without advancing, then continuing, is a no-op.
    const ref = createRng(42);
    const refSeq = Array.from({ length: 8 }, () => ref.next());

    const probed = createRng(42);
    probed.getState(); // read-only; must not advance the stream
    const probedSeq = Array.from({ length: 8 }, () => probed.next());
    expect(probedSeq).toEqual(refSeq);
  });
});
