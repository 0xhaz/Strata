/**
 * Rebalance decision logic — pure (tranche-design.md §5, §9).
 *
 * Each cycle: compute current LP delta → target short → drift vs threshold T.
 * Rebalance the perp only when drift exceeds T. The sim (§9) found a real knee
 * around T ≈ 5–8%: over-rebalancing (gas/funding bleed) is the bigger naive
 * mistake than under-rebalancing. Default T = 0.06.
 *
 * Two-venue safety (design §6 [RISK]): if either venue read is stale/missing, do
 * NOT act on half the picture — the caller passes `stale: true` and we skip.
 */
import { Decimal, D } from "./decimal.js";
import { isInRange } from "./clmm-delta.js";
import { fundingClassification } from "./size-hedge.js";
import type {
  FundingSignal,
  Range,
  RebalanceDecision,
} from "./types.js";

export const DEFAULT_THRESHOLD = 0.06; // T ≈ 5–8% (sim §9); configurable

/** Relative drift between the current short and the target short. */
export function driftPct(
  currentShortSol: Decimal | number,
  targetShortSol: Decimal | number,
): Decimal {
  const target = D(targetShortSol);
  const gap = D(currentShortSol).minus(target).abs();
  // Guard a ~zero target (price above range → delta 0). Any open short is full drift.
  if (target.abs().lt(1e-9)) {
    return gap.lt(1e-9) ? D(0) : D(1);
  }
  return gap.div(target.abs());
}

export function shouldRebalance(
  currentShortSol: Decimal | number,
  targetShortSol: Decimal | number,
  threshold = DEFAULT_THRESHOLD,
): boolean {
  return driftPct(currentShortSol, targetShortSol).gt(threshold);
}

export interface DecisionInput {
  ts: number;
  price: number;
  range: Range;
  solFraction: number;
  currentShortSol: number;
  targetShortSol: number;
  funding: Pick<FundingSignal, "fundingRateAnnualized">;
  threshold?: number;
  stale?: boolean; // partial two-venue read → skip the cycle
}

/**
 * Decide the action for one wake cycle. Precedence:
 *   stale read → skip  >  price out of range → re-range  >  drift > T → rebalance  >  hold
 */
export function decideRebalance(input: DecisionInput): RebalanceDecision {
  const threshold = input.threshold ?? DEFAULT_THRESHOLD;
  const drift = driftPct(input.currentShortSol, input.targetShortSol);
  const carry = fundingClassification(input.funding);
  const base = {
    ts: input.ts,
    price: input.price,
    solFraction: input.solFraction,
    currentShortSol: input.currentShortSol,
    targetShortSol: input.targetShortSol,
    driftPct: drift.toNumber(),
    thresholdPct: threshold,
    funding: { annualized: input.funding.fundingRateAnnualized, carryOrCost: carry },
  };

  if (input.stale) {
    return {
      ...base,
      action: "skip-stale",
      reason:
        "Partial two-venue read — one of Solana LP / Hyperliquid perp is stale. " +
        "Holding rather than acting on half-current state (design §6).",
    };
  }

  if (!isInRange(input.price, input.range)) {
    return {
      ...base,
      action: "re-range",
      reason:
        `Price ${input.price} exited range [${input.range.lower}, ${input.range.upper}] — ` +
        "LP is single-sided and stopped earning fees; re-range LP and reset hedge (design §5 step 6).",
    };
  }

  if (drift.gt(threshold)) {
    return {
      ...base,
      action: "rebalance",
      reason:
        `Drift ${(drift.toNumber() * 100).toFixed(2)}% > T ${(threshold * 100).toFixed(1)}% — ` +
        `resize short from ${input.currentShortSol.toFixed(4)} to ${input.targetShortSol.toFixed(4)} SOL ` +
        `to restore senior delta-neutrality. Funding ${carry}.`,
    };
  }

  return {
    ...base,
    action: "hold",
    reason:
      `Drift ${(drift.toNumber() * 100).toFixed(2)}% ≤ T ${(threshold * 100).toFixed(1)}% — ` +
      `within band; no resize (avoid over-rebalancing churn, sim §9). Funding ${carry}.`,
  };
}
