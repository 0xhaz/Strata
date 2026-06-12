import { describe, it, expect } from "vitest";
import {
  clmmSolFraction,
  isInRange,
  lpDeltaSolFromNotional,
} from "../lib/clmm-delta.js";

// Range used by sim/rebalance_sim.py: [0.85·150, 1.15·150] = [127.5, 172.5].
const RANGE = { lower: 127.5, upper: 172.5 };

// Reference values computed directly from clmm_sol_fraction() in the Python sim
// (no numpy) — these pin the TS port bit-for-bit against the design source.
const FIXTURES: Array<[number, number]> = [
  [120.0, 1.0],
  [127.5, 1.0],
  [135.0, 0.8036921292],
  [142.5, 0.6274506792],
  [150.0, 0.4637546089],
  [157.5, 0.3072372849],
  [165.0, 0.1537847548],
  [172.5, 0.0],
  [180.0, 0.0],
];

describe("clmmSolFraction matches the Python sim reference", () => {
  for (const [price, expected] of FIXTURES) {
    it(`price ${price} → ${expected}`, () => {
      expect(clmmSolFraction(price, RANGE)).toBeCloseTo(expected, 9);
    });
  }

  it("is ~all SOL at/below range-low, ~all USDC at/above range-high", () => {
    expect(clmmSolFraction(100, RANGE)).toBe(1);
    expect(clmmSolFraction(200, RANGE)).toBe(0);
  });

  it("is monotonically decreasing across the range", () => {
    let prev = Infinity;
    for (let p = 127.5; p <= 172.5; p += 1) {
      const f = clmmSolFraction(p, RANGE);
      expect(f).toBeLessThanOrEqual(prev + 1e-12);
      prev = f;
    }
  });
});

describe("isInRange", () => {
  it("true inside, false outside (inclusive bounds)", () => {
    expect(isInRange(150, RANGE)).toBe(true);
    expect(isInRange(127.5, RANGE)).toBe(true);
    expect(isInRange(172.5, RANGE)).toBe(true);
    expect(isInRange(127.49, RANGE)).toBe(false);
    expect(isInRange(172.51, RANGE)).toBe(false);
  });
});

describe("lpDeltaSolFromNotional", () => {
  it("delta in SOL = fraction · notional / price", () => {
    const price = 150;
    const notional = 10_000;
    const frac = clmmSolFraction(price, RANGE);
    expect(lpDeltaSolFromNotional(price, RANGE, notional)).toBeCloseTo(
      (frac * notional) / price,
      9,
    );
  });
});
