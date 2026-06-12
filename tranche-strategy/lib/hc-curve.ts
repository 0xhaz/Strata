/**
 * h / c curve — sets the two control parameters dynamically from how the user
 * splits their OWN capital into senior (protected) vs junior (exposed) sleeves.
 *
 * Faithful TypeScript port of sim/hc_curve.py, which adapts BarnBridge's
 * SeniorRateModelV3 shape (caps + piecewise-from-ratio) to our setting.
 * Conceptual reference only — no BarnBridge code is lifted (CLAUDE.md rule 6).
 *
 *   h = hedge ratio (0..1)     — fraction of senior LP-delta we short on Hyperliquid
 *   c = coupon target (annual) — fixed-ish yield promised to senior
 *
 * Funding carry, when positive, is UPSIDE on top of c — never baseline (design D-04).
 */
import { Decimal, D, clamp } from "./decimal.js";
import type { SleeveAllocation, TrancheParams } from "./types.js";

// ---- caps: the "never promise more than delivered" guardrails ----
export const H_MAX = D(1.0); // never short more than 100% of senior delta
export const C_MAX_ABS = D(0.12); // hard ceiling: never promise senior > 12% annual
export const C_FLOOR = D(0.02); // below this the senior sleeve isn't worth offering
export const PROTECTION_MAX_PCT = D(0.8); // BarnBridge relative cap
export const PROTECTION_MAX_ABS = D(0.35); // BarnBridge absolute cap
export const SPLIT_POINT = D(0.05); // BarnBridge piecewise knee at 5% junior dominance
export const RAMP_TOP = D(0.4); // h reaches H_MAX by jShare = 40%

// expected gross yield sources (annualized, conservative — starting values)
export const LP_FEE_APR = D(0.06); // ~6% fee APR on a SOL/USDC concentrated pos
export const HEDGE_COST_APR = D(0.03); // ~ sim §9 net cost at T≈8%

export function juniorShare(a: SleeveAllocation): Decimal {
  const total = D(a.seniorCapUsd).plus(a.juniorCapUsd);
  return total.isZero() ? D(0) : D(a.juniorCapUsd).div(total);
}

/**
 * More junior buffer ⇒ we can afford to hedge senior more fully.
 * Below the split point: too little buffer ⇒ hedge lightly (ramp 0→0.5 over [0,5%]).
 * Above split: ramp 0.5→1.0 as jShare goes 5%→40%.
 */
export function hedgeRatioH(jShare: Decimal): Decimal {
  if (jShare.lt(SPLIT_POINT)) {
    return Decimal.min(H_MAX, jShare.div(SPLIT_POINT).mul(0.5));
  }
  const frac = Decimal.min(
    D(1),
    jShare.minus(SPLIT_POINT).div(RAMP_TOP.minus(SPLIT_POINT)),
  );
  return Decimal.min(H_MAX, D(0.5).plus(frac.mul(0.5)));
}

/** BarnBridge-style: protection scales with junior share, capped at 35% absolute. */
export function downsideProtection(jShare: Decimal): Decimal {
  return Decimal.min(PROTECTION_MAX_PCT.mul(jShare), PROTECTION_MAX_ABS);
}

/**
 * Coupon the senior can be promised = what actually reaches senior after costs,
 * scaled by how protected/buffered they are, clamped hard.
 *   gross_to_senior ≈ LP fees − hedge cost × h   (funding excluded = upside only)
 *   confidence      = protection / 0.35          (0..1, full at max protection)
 *   c               = gross × (0.5 + 0.5·confidence), then clamp; 0 if below floor
 */
export function couponC(jShare: Decimal, h: Decimal): Decimal {
  const gross = LP_FEE_APR.minus(HEDGE_COST_APR.mul(h));
  const prot = downsideProtection(jShare);
  const confidence = Decimal.min(D(1), prot.div(PROTECTION_MAX_ABS));
  const c = gross.mul(D(0.5).plus(confidence.mul(0.5)));
  if (c.lt(C_FLOOR)) return D(0);
  return clamp(c, 0, C_MAX_ABS);
}

/** Full spec for a given capital split — the agent's control parameters. */
export function trancheParams(a: SleeveAllocation): TrancheParams {
  const js = juniorShare(a);
  const h = hedgeRatioH(js);
  const c = couponC(js, h);
  const prot = downsideProtection(js);
  return {
    juniorShare: js.toNumber(),
    seniorShare: D(1).minus(js).toNumber(),
    h: h.toNumber(),
    c: c.toNumber(),
    protection: prot.toNumber(),
  };
}
