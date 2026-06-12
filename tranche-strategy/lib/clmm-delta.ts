/**
 * CLMM delta — the number the whole hedge rests on (tranche-design.md §3).
 *
 * Two ways to get it, in order of preference:
 *  1. PROXY (preferred, design §3 [DECIDED]): delta ≈ the SOL token amount currently
 *     in the LP position, read straight from `positions analyze`. No closed form.
 *  2. CLOSED FORM: when we only have price+range+notional (e.g. the sim/replay path),
 *     derive the SOL value-fraction of a Uniswap-v3-style position from the sqrt-price
 *     rule, then convert to a SOL amount.
 *
 * `clmmSolFraction` is a unitless geometric ratio (not money) so it uses Number to
 * match the Python reference (sim/rebalance_sim.py) bit-for-bit. Everything that turns
 * it into a position size lives in size-hedge.ts and uses Decimal.
 */
import type { LpState, Range } from "./types.js";

/**
 * Fraction of a concentrated LP position's *value* held in SOL.
 * At/below range-low → ~all SOL (1.0); at/above range-high → ~all USDC (0.0);
 * smooth in between via the v3 sqrt-price rule. Mirrors clmm_sol_fraction() in
 * sim/rebalance_sim.py.
 */
export function clmmSolFraction(price: number, range: Range): number {
  const { lower: pa, upper: pb } = range;
  const p = Math.min(pb, Math.max(pa, price)); // clip into range
  const sp = Math.sqrt(p);
  const spa = Math.sqrt(pa);
  const spb = Math.sqrt(pb);
  const solAmt = 1.0 / sp - 1.0 / spb; // ∝ volatile token held
  const usdcAmt = sp - spa; // ∝ stable token held
  const solVal = solAmt * p;
  const usdcVal = usdcAmt;
  const total = solVal + usdcVal;
  return total > 0 ? solVal / total : 0.0;
}

/** True when current price has left the active range (LP stops earning fees). */
export function isInRange(price: number, range: Range): boolean {
  return price >= range.lower && price <= range.upper;
}

/**
 * The delta proxy in SOL terms.
 *  - From live LP state: just the SOL amount the position holds (design §3).
 *  - When only price/range/notional are known: solFraction × notional / price.
 */
export function lpDeltaSol(lp: Pick<LpState, "solAmount">): number {
  return lp.solAmount;
}

export function lpDeltaSolFromNotional(
  price: number,
  range: Range,
  notionalUsd: number,
): number {
  const frac = clmmSolFraction(price, range);
  return (frac * notionalUsd) / price;
}
