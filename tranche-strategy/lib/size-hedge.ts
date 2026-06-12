/**
 * Hedge sizing (tranche-design.md §3–§5).
 *
 *   target short = h × senior_share × delta
 *
 * where delta is the SOL token amount in the LP position (the proxy). We only
 * hedge the SENIOR sleeve's share of the delta — the junior keeps its directional
 * exposure on purpose (that's the levered residual).
 *
 * Funding is treated as carry/cost UPSIDE, never baked into the size (design D-04).
 */
import { Decimal, D } from "./decimal.js";
import type { FundingSignal } from "./types.js";

export interface HedgeTarget {
  shortSol: Decimal; // size of the short, in SOL (positive magnitude)
  shortUsd: Decimal; // notional in USD at the given price
}

/**
 * @param deltaSol  SOL amount in the LP position (delta proxy)
 * @param seniorShare  senior sleeve's fraction of capital (0..1)
 * @param h  hedge ratio (0..1)
 * @param price  current SOL/USDC price
 */
export function targetShort(
  deltaSol: Decimal | number,
  seniorShare: Decimal | number,
  h: Decimal | number,
  price: Decimal | number,
): HedgeTarget {
  const shortSol = D(deltaSol).mul(D(seniorShare)).mul(D(h));
  return { shortSol, shortUsd: shortSol.mul(D(price)) };
}

/**
 * Classify the funding regime for a SHORT hedge.
 * Crib from perps-cli signal scan: "for shorts, positive funding is good."
 * Positive SOL funding ⇒ we are PAID to hold the short ⇒ carry (subsidizes coupon).
 */
export function fundingClassification(
  signal: Pick<FundingSignal, "fundingRateAnnualized">,
  flatBandAnnualized = 0.005,
): "carry" | "cost" | "flat" {
  const f = signal.fundingRateAnnualized;
  if (Math.abs(f) <= flatBandAnnualized) return "flat";
  return f > 0 ? "carry" : "cost";
}

/** Annualized funding carry/cost in USD on a short of `shortUsd` notional. */
export function fundingCarryUsd(
  shortUsd: Decimal | number,
  signal: Pick<FundingSignal, "fundingRateAnnualized">,
): Decimal {
  // Short earns when funding is positive → carry is +. Sign of annualized rate
  // already encodes direction; short flips nothing because positive = we receive.
  return D(shortUsd).mul(signal.fundingRateAnnualized);
}
