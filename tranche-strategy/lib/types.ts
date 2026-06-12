/**
 * Shared types for the tranche-strategy skill.
 *
 * The math layer (lib/) takes numbers in and gives numbers out — no network.
 * The I/O layer (adapters/, scripts/) fetches the numbers. These types are the
 * contract between them and mirror the documented Byreal `-o json` shapes
 * (techstacks.md §5). When the real CLIs land, validate the live JSON against
 * these before trusting a field (CLAUDE.md: "the press-release feature list is
 * not the schema").
 */

/** A concentrated-liquidity range, in price (USDC per SOL). */
export interface Range {
  lower: number; // Pa
  upper: number; // Pb
}

/** Snapshot of the CLMM yield leg (from `byreal-cli positions analyze -o json`). */
export interface LpState {
  nftMint: string;
  pool: string;
  price: number; // current pool price, USDC per SOL
  range: Range;
  solAmount: number; // SOL token currently in the position — our delta proxy
  usdcAmount: number; // USDC token currently in the position
  feesAccruedUsd: number; // unclaimed fees, USD
  inRange: boolean;
}

/** Snapshot of the Hyperliquid perp hedge (from `byreal-perps-cli position list -o json`). */
export interface PerpState {
  coin: string; // "SOL"
  dex: "main" | "xyz"; // always "main" for SOL — bare tickers can silent-route
  sizeSol: number; // signed; negative = short. Hedge is short → negative.
  entryPrice: number;
  markPrice: number;
  unrealizedPnlUsd: number;
  leverage: number;
}

/** Funding read (from `byreal-perps-cli signal detail SOL -o json`). */
export interface FundingSignal {
  coin: string;
  fundingRate1h: number; // fractional, per 1h interval
  fundingRateAnnualized: number; // fractional, annualized
  markPrice: number;
  openInterestUsd: number;
}

/** How the user split their OWN capital. Single-user only — never pooled. */
export interface SleeveAllocation {
  seniorCapUsd: number;
  juniorCapUsd: number;
}

/** Output of the h/c curve — the two control parameters + derived protection. */
export interface TrancheParams {
  juniorShare: number; // 0..1
  seniorShare: number; // 0..1
  h: number; // hedge ratio 0..1
  c: number; // coupon target, annualized fractional
  protection: number; // downside protection fraction (capped)
}

/** The rebalance decision emitted each cycle (and logged on-chain). */
export interface RebalanceDecision {
  ts: number;
  action: "rebalance" | "hold" | "re-range" | "skip-stale";
  reason: string;
  price: number;
  solFraction: number;
  currentShortSol: number;
  targetShortSol: number;
  driftPct: number;
  thresholdPct: number;
  funding: { annualized: number; carryOrCost: "carry" | "cost" | "flat" };
}
