import { describe, it, expect } from "vitest";
import {
  driftPct,
  shouldRebalance,
  decideRebalance,
  DEFAULT_THRESHOLD,
} from "../lib/rebalance.js";

const RANGE = { lower: 127.5, upper: 172.5 };
const FLAT = { fundingRateAnnualized: 0.1 }; // positive → carry

describe("driftPct", () => {
  it("relative gap vs target", () => {
    expect(driftPct(24, 24).toNumber()).toBe(0);
    expect(driftPct(26.4, 24).toNumber()).toBeCloseTo(0.1, 9);
    expect(driftPct(21.6, 24).toNumber()).toBeCloseTo(0.1, 9);
  });

  it("zero target with an open short = full drift (price left range above)", () => {
    expect(driftPct(5, 0).toNumber()).toBe(1);
    expect(driftPct(0, 0).toNumber()).toBe(0);
  });
});

describe("shouldRebalance honours threshold T", () => {
  it("only fires above T", () => {
    expect(shouldRebalance(24 * 1.05, 24, 0.06)).toBe(false); // 5% < 6%
    expect(shouldRebalance(24 * 1.07, 24, 0.06)).toBe(true); // 7% > 6%
  });
});

describe("decideRebalance precedence", () => {
  const base = {
    ts: 1,
    price: 150,
    range: RANGE,
    solFraction: 0.46,
    funding: FLAT,
  };

  it("stale read → skip (never act on half-current state)", () => {
    const d = decideRebalance({
      ...base,
      currentShortSol: 24,
      targetShortSol: 30,
      stale: true,
    });
    expect(d.action).toBe("skip-stale");
  });

  it("out of range → re-range, even if drift is small", () => {
    const d = decideRebalance({
      ...base,
      price: 180,
      currentShortSol: 24,
      targetShortSol: 24,
    });
    expect(d.action).toBe("re-range");
  });

  it("in range + drift > T → rebalance", () => {
    const d = decideRebalance({
      ...base,
      currentShortSol: 24 * 1.1,
      targetShortSol: 24,
    });
    expect(d.action).toBe("rebalance");
    expect(d.driftPct).toBeCloseTo(0.1, 9);
  });

  it("in range + drift ≤ T → hold (avoid churn)", () => {
    const d = decideRebalance({
      ...base,
      currentShortSol: 24 * 1.03,
      targetShortSol: 24,
    });
    expect(d.action).toBe("hold");
  });

  it("attaches funding carry/cost classification", () => {
    const d = decideRebalance({
      ...base,
      currentShortSol: 24,
      targetShortSol: 24,
      funding: { fundingRateAnnualized: -0.2 },
    });
    expect(d.funding.carryOrCost).toBe("cost");
  });

  it("default threshold is in the sim's 5–8% knee", () => {
    expect(DEFAULT_THRESHOLD).toBeGreaterThanOrEqual(0.05);
    expect(DEFAULT_THRESHOLD).toBeLessThanOrEqual(0.08);
  });
});
