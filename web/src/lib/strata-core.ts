/**
 * Vendored pure preview math (plain numbers) — mirrors tranche-strategy/lib so the web app
 * is self-contained and deploys as a standard Next.js app (no monorepo build dependency).
 * Display-only estimates; the authoritative money math lives in the agent + the on-chain vault.
 */

// h/c curve caps (BarnBridge-derived shape; conceptual reference only).
const C_MAX_ABS = 0.12;
const C_FLOOR = 0.02;
const SPLIT = 0.05;
const RAMP_TOP = 0.4;
const LP_FEE_APR = 0.06;
const HEDGE_COST_APR = 0.03;

export const DEFAULT_THRESHOLD = 0.06;

export function clmmSolFraction(price: number, range: { lower: number; upper: number }): number {
  const { lower: pa, upper: pb } = range;
  const p = Math.min(pb, Math.max(pa, price));
  const sp = Math.sqrt(p), spa = Math.sqrt(pa), spb = Math.sqrt(pb);
  const solVal = (1 / sp - 1 / spb) * p;
  const usdcVal = sp - spa;
  const total = solVal + usdcVal;
  return total > 0 ? solVal / total : 0;
}

function hedgeRatioH(js: number): number {
  if (js < SPLIT) return Math.min(1, (js / SPLIT) * 0.5);
  return Math.min(1, 0.5 + 0.5 * Math.min(1, (js - SPLIT) / (RAMP_TOP - SPLIT)));
}
function downsideProtection(js: number): number {
  return Math.min(0.8 * js, 0.35);
}
function couponC(js: number, h: number): number {
  const gross = LP_FEE_APR - HEDGE_COST_APR * h;
  const confidence = Math.min(1, downsideProtection(js) / 0.35);
  const c = gross * (0.5 + 0.5 * confidence);
  if (c < C_FLOOR) return 0;
  return Math.max(0, Math.min(C_MAX_ABS, c));
}

export interface TrancheParams {
  juniorShare: number;
  seniorShare: number;
  h: number;
  c: number;
  protection: number;
}

export function trancheParams(a: { seniorCapUsd: number; juniorCapUsd: number }): TrancheParams {
  const total = a.seniorCapUsd + a.juniorCapUsd;
  const js = total === 0 ? 0 : a.juniorCapUsd / total;
  const h = hedgeRatioH(js);
  return { juniorShare: js, seniorShare: 1 - js, h, c: couponC(js, h), protection: downsideProtection(js) };
}

export function targetShort(deltaSol: number, seniorShare: number, h: number, price: number) {
  const shortSol = deltaSol * seniorShare * h;
  return { shortSol, shortUsd: shortSol * price };
}
