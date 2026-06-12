/**
 * Byreal CLMM (Solana) yield-leg adapter — wraps `byreal-cli` (verified 0.3.6).
 *
 * We compose, never rebuild: pool selection, range recommendations, and the
 * auto-swap zap are the CLI's job. We read the structured `-o json` output and map
 * it onto our types.
 *
 * VERIFIED 2026-06-10 against the live CLI (Phase-0 gate). Key realities baked in:
 *  - Responses are `{success, meta, data}` — unwrapped via byreal-json.ts.
 *  - A position query exposes `liquidityUsd` + price bounds + `inRange`, but NOT a
 *    direct SOL token amount. So the delta proxy is DERIVED from the closed-form
 *    CLMM fraction (lib/clmm-delta.ts), not read off the position. The design's
 *    "delta ≈ SOL amount in position" simplification is not available in this CLI;
 *    the derivation is the supported path.
 *  - `positions open` supports `--unsigned-tx --wallet-address` → builds an UNSIGNED
 *    tx for the agent-token handoff. We NEVER sign (CLAUDE.md rule 1).
 */
import { runJson } from "./exec.js";
import { unwrap, parseNum, parsePct, pickNum } from "./byreal-json.js";
import { clmmSolFraction } from "../lib/clmm-delta.js";
import type { LpState, Range } from "../lib/types.js";

const BIN = "byreal-cli";

export interface PoolSummary {
  id: string;
  pair: string;
  currentPrice: number;
  totalApr: number; // fractional
  feeRateBps: number;
  tvlUsd: number;
}

/** Survey pools, default sorted by 24h APR. Returns the SOL/USDC candidates first. */
export async function poolsList(sortField = "apr24h"): Promise<PoolSummary[]> {
  const data = unwrap<{ pools: Record<string, unknown>[] }>(
    await runJson(BIN, ["pools", "list", "--sort-field", sortField]),
  );
  const pools = Array.isArray(data) ? data : (data.pools ?? []);
  return (pools as Record<string, unknown>[]).map((p) => ({
    id: String(p.id ?? ""),
    pair: String(p.pair ?? ""),
    currentPrice: parseNum(p.current_price) ?? 0,
    totalApr: (parseNum(p.total_apr) ?? 0) / 100, // CLI reports APR as a percent number (44.26)
    feeRateBps: parseNum(p.fee_rate_bps) ?? 0,
    tvlUsd: parseNum(p.tvl_usd) ?? 0,
  }));
}

export interface RangeRec {
  rangePercent: number;
  lower: number;
  upper: number;
  estimatedFeeApr: number; // fractional
  inRangeLikelihood: string;
  rebalanceFrequency: string;
}

/** Pool analysis incl. the CLI's own range recommendations — we read, not compute. */
export async function poolAnalyze(pool: string): Promise<{
  currentPrice: number;
  feeApr24h: number;
  rangeRecs: RangeRec[];
  raw: unknown;
}> {
  const data = unwrap<Record<string, unknown>>(await runJson(BIN, ["pools", "analyze", pool]));
  const poolObj = (data.pool ?? {}) as Record<string, unknown>;
  const metrics = (data.metrics ?? {}) as Record<string, unknown>;
  const recs = (data.rangeAnalysis ?? []) as Record<string, unknown>[];
  return {
    currentPrice: parseNum(poolObj.currentPrice) ?? 0,
    feeApr24h: parsePct(metrics.feeApr24h) ?? 0,
    rangeRecs: recs.map((r) => ({
      rangePercent: parseNum(r.rangePercent) ?? 0,
      lower: parseNum(r.priceLower) ?? 0,
      upper: parseNum(r.priceUpper) ?? 0,
      estimatedFeeApr: parsePct(r.estimatedFeeApr) ?? 0,
      inRangeLikelihood: String(r.inRangeLikelihood ?? ""),
      rebalanceFrequency: String(r.rebalanceFrequency ?? ""),
    })),
    raw: data,
  };
}

/**
 * Read a position and produce LpState. The SOL delta proxy is DERIVED from
 * liquidityUsd + range + current price (the closed-form fraction), since the CLI
 * does not expose a direct token amount. If a future CLI build adds an explicit
 * SOL-amount field, `normalizeLpState` prefers it.
 */
export async function positionAnalyze(nftMint: string, currentPrice?: number): Promise<LpState> {
  const data = unwrap<Record<string, unknown>>(await runJson(BIN, ["positions", "analyze", nftMint]));
  return normalizeLpState(data, currentPrice);
}

export function normalizeLpState(raw: Record<string, unknown>, currentPriceHint?: number): LpState {
  const range: Range = {
    lower: pickNum(raw, "priceLower", "tickLowerPrice", "rangeLow") ?? 0,
    upper: pickNum(raw, "priceUpper", "tickUpperPrice", "rangeHigh") ?? 0,
  };
  const price = pickNum(raw, "currentPrice", "price", "poolPrice") ?? currentPriceHint ?? 0;
  const liquidityUsd = pickNum(raw, "liquidityUsd", "totalValueUsd", "valueUsd") ?? 0;

  // Prefer an explicit token amount if the CLI ever provides one; else derive it.
  const explicitSol = pickNum(raw, "amountA", "solAmount", "baseAmount", "tokenAAmount");
  const fraction = price > 0 && range.upper > 0 ? clmmSolFraction(price, range) : 0;
  const solAmount = explicitSol ?? (price > 0 ? (fraction * liquidityUsd) / price : 0);

  return {
    nftMint: String(raw.nftMintAddress ?? raw.nftMint ?? raw.mint ?? ""),
    pool: String(raw.poolAddress ?? raw.pool ?? raw.poolId ?? ""),
    price,
    range,
    solAmount,
    usdcAmount: pickNum(raw, "amountB", "usdcAmount", "quoteAmount") ?? Math.max(0, liquidityUsd - solAmount * price),
    feesAccruedUsd: pickNum(raw, "earnedUsd", "unclaimedFeesUsd", "pendingFees") ?? 0,
    inRange: typeof raw.inRange === "boolean" ? raw.inRange : price >= range.lower && price <= range.upper,
  };
}

export interface OpenPositionOpts {
  pool: string;
  priceLower: number;
  priceUpper: number;
  baseMint: string; // single-token input with --auto-swap
  amount: number;
  walletAddress: string; // build UNSIGNED for the agent-token handoff — no local keypair
}

/**
 * Build an UNSIGNED open-position tx (RealClaw pattern). Output is handed to the
 * agent-token skill for signing + broadcast. We never sign here (CLAUDE.md rule 1).
 */
export function buildOpenPositionUnsigned(o: OpenPositionOpts): Promise<unknown> {
  return runJson(BIN, [
    "positions", "open",
    "--pool", o.pool,
    "--price-lower", String(o.priceLower),
    "--price-upper", String(o.priceUpper),
    "--base", o.baseMint,
    "--amount", String(o.amount),
    "--auto-swap",
    "--unsigned-tx",
    "--wallet-address", o.walletAddress,
  ]);
}
