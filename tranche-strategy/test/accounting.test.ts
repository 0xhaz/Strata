import { describe, it, expect } from "vitest";
import { accrueCoupon, settlePeriod } from "../lib/accounting.js";

describe("accrueCoupon", () => {
  it("seniorCap · c · Δt", () => {
    // $6000 senior at 3% over half a year = $90
    expect(accrueCoupon(6000, 0.03, 0.5).toNumber()).toBeCloseTo(90, 9);
  });
});

describe("settlePeriod — junior buffer flow (BarnBridge minPrice floor analogue)", () => {
  const baseOwed = { seniorCapUsd: 6000, couponAnnual: 0.03, dtYears: 0.5 }; // owed $90

  it("realized > coupon → junior keeps the excess", () => {
    const s = settlePeriod({
      ...baseOwed,
      seniorFeesUsd: 120,
      fundingUsd: 0,
      seniorIlUsd: 0,
      juniorBufferUsd: 4000,
    });
    expect(s.couponOwedUsd).toBeCloseTo(90, 6);
    expect(s.excessUsd).toBeCloseTo(30, 6);
    expect(s.shortfallUsd).toBe(0);
    expect(s.seniorPaidUsd).toBeCloseTo(90, 6); // senior gets exactly its coupon
    expect(s.juniorBufferEndUsd).toBeCloseTo(4030, 6); // buffer grows by the excess
    expect(s.bufferBreached).toBe(false);
  });

  it("realized < coupon → junior buffer absorbs the shortfall, senior still paid", () => {
    const s = settlePeriod({
      ...baseOwed,
      seniorFeesUsd: 50,
      fundingUsd: 0,
      seniorIlUsd: 10, // realized = 40, owed 90 → shortfall 50
      juniorBufferUsd: 4000,
    });
    expect(s.seniorRealizedUsd).toBeCloseTo(40, 6);
    expect(s.shortfallUsd).toBeCloseTo(50, 6);
    expect(s.seniorPaidUsd).toBeCloseTo(90, 6); // protected — paid in full
    expect(s.juniorBufferEndUsd).toBeCloseTo(3950, 6); // buffer covers the $50
    expect(s.bufferBreached).toBe(false);
    expect(s.uncoveredUsd).toBe(0);
  });

  it("funding carry flows into realized as a bonus on fees", () => {
    const s = settlePeriod({
      ...baseOwed,
      seniorFeesUsd: 60,
      fundingUsd: 40, // carry pushes realized to 100 > 90
      seniorIlUsd: 0,
      juniorBufferUsd: 4000,
    });
    expect(s.seniorRealizedUsd).toBeCloseTo(100, 6);
    expect(s.excessUsd).toBeCloseTo(10, 6);
  });

  it("buffer exhausted → senior eats the uncovered remainder, breach flagged", () => {
    const s = settlePeriod({
      ...baseOwed,
      seniorFeesUsd: 0,
      fundingUsd: 0,
      seniorIlUsd: 0, // realized 0, owed 90 → shortfall 90
      juniorBufferUsd: 30, // buffer can only cover $30
    });
    expect(s.shortfallUsd).toBeCloseTo(90, 6);
    expect(s.juniorBufferEndUsd).toBe(0); // wiped out, never negative
    expect(s.uncoveredUsd).toBeCloseTo(60, 6);
    expect(s.seniorPaidUsd).toBeCloseTo(30, 6); // only the covered part
    expect(s.bufferBreached).toBe(true);
  });

  it("junior buffer can never go below zero", () => {
    const s = settlePeriod({
      ...baseOwed,
      seniorFeesUsd: 0,
      fundingUsd: -500, // heavy funding cost
      seniorIlUsd: 100,
      juniorBufferUsd: 10,
    });
    expect(s.juniorBufferEndUsd).toBe(0);
    expect(s.bufferBreached).toBe(true);
  });
});
