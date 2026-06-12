import { describe, it, expect } from "vitest";
import {
  trancheParams,
  hedgeRatioH,
  couponC,
  downsideProtection,
  juniorShare,
  C_MAX_ABS,
  PROTECTION_MAX_ABS,
} from "../lib/hc-curve.js";
import { D } from "../lib/decimal.js";

// Expected values from the design-doc table (tranche-design.md §10) and the
// reference run of sim/hc_curve.py captured during the build.
//   senior  junior | jShare |  h   |  c    | protect
const TABLE: Array<{
  s: number;
  j: number;
  jShare: number;
  h: number;
  c: number;
  prot: number;
}> = [
  { s: 9500, j: 500, jShare: 0.05, h: 0.5, c: 0.025, prot: 0.04 },
  { s: 9000, j: 1000, jShare: 0.1, h: 0.5714285714, c: 0.026, prot: 0.08 },
  { s: 8000, j: 2000, jShare: 0.2, h: 0.7142857143, c: 0.028, prot: 0.16 },
  { s: 7000, j: 3000, jShare: 0.3, h: 0.8571428571, c: 0.029, prot: 0.24 },
  { s: 6000, j: 4000, jShare: 0.4, h: 1.0, c: 0.029, prot: 0.32 },
  { s: 5000, j: 5000, jShare: 0.5, h: 1.0, c: 0.03, prot: 0.35 },
  { s: 4000, j: 6000, jShare: 0.6, h: 1.0, c: 0.03, prot: 0.35 },
  { s: 3000, j: 7000, jShare: 0.7, h: 1.0, c: 0.03, prot: 0.35 },
];

describe("h/c curve reproduces the design-doc §10 table", () => {
  for (const row of TABLE) {
    it(`split ${row.s}/${row.j} → jShare ${row.jShare}`, () => {
      const p = trancheParams({ seniorCapUsd: row.s, juniorCapUsd: row.j });
      expect(p.juniorShare).toBeCloseTo(row.jShare, 6);
      expect(p.seniorShare).toBeCloseTo(1 - row.jShare, 6);
      expect(p.h).toBeCloseTo(row.h, 6);
      // table prints coupon to 1 decimal % — match to that resolution
      expect(p.c).toBeCloseTo(row.c, 3);
      expect(p.protection).toBeCloseTo(row.prot, 6);
    });
  }
});

describe("caps hold (the BarnBridge guardrail)", () => {
  it("protection never exceeds 35% absolute no matter how much junior piles in", () => {
    for (const j of [5000, 7000, 9000, 9900]) {
      const p = trancheParams({ seniorCapUsd: 10_000 - j, juniorCapUsd: j });
      expect(p.protection).toBeLessThanOrEqual(PROTECTION_MAX_ABS.toNumber() + 1e-12);
    }
  });

  it("hedge ratio never exceeds 1.0", () => {
    for (let jShare = 0; jShare <= 1; jShare += 0.05) {
      expect(hedgeRatioH(D(jShare)).toNumber()).toBeLessThanOrEqual(1.0 + 1e-12);
    }
  });

  it("coupon never exceeds the 12% hard ceiling", () => {
    for (let jShare = 0; jShare <= 1; jShare += 0.02) {
      const h = hedgeRatioH(D(jShare));
      expect(couponC(D(jShare), h).toNumber()).toBeLessThanOrEqual(
        C_MAX_ABS.toNumber() + 1e-12,
      );
    }
  });
});

describe("thin-buffer behaviour", () => {
  it("below the 5% split point, h is capped low (structure barely works)", () => {
    expect(hedgeRatioH(D(0.025)).toNumber()).toBeCloseTo(0.25, 6);
    expect(hedgeRatioH(D(0.0)).toNumber()).toBe(0);
  });

  it("zero capital → zero everything, no divide-by-zero", () => {
    expect(juniorShare({ seniorCapUsd: 0, juniorCapUsd: 0 }).toNumber()).toBe(0);
    expect(downsideProtection(D(0)).toNumber()).toBe(0);
  });
});
