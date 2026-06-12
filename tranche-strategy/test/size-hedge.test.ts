import { describe, it, expect } from "vitest";
import {
  targetShort,
  fundingClassification,
  fundingCarryUsd,
} from "../lib/size-hedge.js";

describe("targetShort = h · seniorShare · delta", () => {
  it("hedges only the senior share of the LP delta", () => {
    // delta 40 SOL, senior 60%, h=1, price 150
    const t = targetShort(40, 0.6, 1.0, 150);
    expect(t.shortSol.toNumber()).toBeCloseTo(24, 9); // 40·0.6·1
    expect(t.shortUsd.toNumber()).toBeCloseTo(24 * 150, 6); // 3600
  });

  it("h scales the hedge linearly; h=0 → no hedge (plain LP)", () => {
    expect(targetShort(40, 0.6, 0.5, 150).shortSol.toNumber()).toBeCloseTo(12, 9);
    expect(targetShort(40, 0.6, 0.0, 150).shortSol.toNumber()).toBe(0);
  });
});

describe("funding classification (short hedge: positive funding = carry)", () => {
  it("positive funding earns carry on a short", () => {
    expect(fundingClassification({ fundingRateAnnualized: 0.1 })).toBe("carry");
  });
  it("negative funding is a cost", () => {
    expect(fundingClassification({ fundingRateAnnualized: -0.1 })).toBe("cost");
  });
  it("within the flat band → flat", () => {
    expect(fundingClassification({ fundingRateAnnualized: 0.002 })).toBe("flat");
  });

  it("carry USD = notional · annualized rate (positive = received)", () => {
    expect(
      fundingCarryUsd(3600, { fundingRateAnnualized: 0.1 }).toNumber(),
    ).toBeCloseTo(360, 6);
    expect(
      fundingCarryUsd(3600, { fundingRateAnnualized: -0.05 }).toNumber(),
    ).toBeCloseTo(-180, 6);
  });
});
