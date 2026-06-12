/**
 * Byreal Perps (Hyperliquid) hedge-leg adapter — wraps `byreal-perps-cli` (verified 0.3.7).
 *
 * VERIFIED 2026-06-10 against the live CLI (Phase-0 gate). Realities baked in:
 *  - Responses are `{success, meta, data}` — unwrapped via byreal-json.ts.
 *  - `signal detail` returns `fundingAnnualized` as a percent STRING ("-2.3%") and
 *    `funding` as a per-interval string; `price`/`oraclePrice` (no `markPrice`).
 *  - There is NO `--dex` flag — the DEX is selected by the coin symbol. SOL routes
 *    on `main`; the `xyz` sub-DEX uses an `xyz:` prefix. So we pass plain "SOL".
 *  - There is NO `--dry-run`/`--confirm`; confirmation is the global `-y/--yes`.
 *    Money-moving calls are gated behind an explicit `confirm` arg (default false).
 *  - `position close-market` takes `--size <n>` for partial (not positional).
 *  - The perps account is token/Privy-based (`account init`, no private key); signing
 *    is internal to the CLI's account, not the Solana --unsigned-tx handoff.
 */
import { runJson } from "./exec.js";
import { unwrap, parseNum, parsePct } from "./byreal-json.js";
import type { FundingSignal, PerpState } from "../lib/types.js";

const BIN = "byreal-perps-cli";

export function accountInfo(): Promise<unknown> {
  return runJson(BIN, ["account", "info"]).then((r) => unwrap(r));
}

/** Funding read — the make-or-break primitive (architecture §1). */
export async function signalDetail(coin = "SOL"): Promise<FundingSignal & { raw: unknown }> {
  const d = unwrap<Record<string, unknown>>(await runJson(BIN, ["signal", "detail", coin]));
  return {
    coin: String(d.coin ?? coin),
    fundingRate1h: parseNum(d.funding) ?? 0, // per-interval (hourly) fractional
    fundingRateAnnualized: parsePct(d.fundingAnnualized) ?? 0, // "-2.3%" → -0.023
    markPrice: parseNum(d.price) ?? parseNum(d.oraclePrice) ?? 0,
    openInterestUsd: parseNum(d.openInterest) ?? 0, // "$3.92M" → 3_920_000
    raw: d,
  };
}

export async function positionList(): Promise<PerpState[]> {
  const data = unwrap<unknown>(await runJson(BIN, ["position", "list"]));
  const arr = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.positions as unknown[]) ?? [];
  return (arr as Record<string, unknown>[]).map((p) => ({
    coin: String(p.coin ?? p.symbol ?? "SOL"),
    dex: String(p.coin ?? "").includes("xyz") ? "xyz" : "main",
    sizeSol: parseNum(p.size ?? p.sizeSol ?? p.szi) ?? 0, // signed; negative = short
    entryPrice: parseNum(p.entryPrice ?? p.entryPx) ?? 0,
    markPrice: parseNum(p.markPrice ?? p.markPx) ?? 0,
    unrealizedPnlUsd: parseNum(p.unrealizedPnl ?? p.uPnl) ?? 0,
    leverage: parseNum(p.leverage) ?? 1,
  }));
}

// ── Money-moving commands. Perps has no dry-run; `confirm` gates the global -y. ──

export interface OrderOpts {
  sizeSol: number;
  tp?: number;
  sl?: number;
  reduceOnly?: boolean;
  confirm?: boolean; // false → interactive prompt (won't auto-execute); true → -y
}

/** Open/resize the SHORT hedge: `order market sell <size> SOL`. No --dex (coin = SOL). */
export function orderMarketSell(o: OrderOpts): Promise<unknown> {
  const args = ["order", "market", "sell", String(o.sizeSol), "SOL"];
  if (o.tp !== undefined) args.push("--tp", String(o.tp));
  if (o.sl !== undefined) args.push("--sl", String(o.sl));
  if (o.reduceOnly) args.push("--reduce-only");
  if (o.confirm) args.push("-y");
  return runJson(BIN, args).then((r) => unwrap(r));
}

/** Reduce/close the hedge. partialSol omitted = full close (uses `--size` for partial). */
export function positionCloseMarket(partialSol?: number, confirm = false): Promise<unknown> {
  const args = ["position", "close-market", "SOL"];
  if (partialSol !== undefined) args.push("--size", String(partialSol));
  if (confirm) args.push("-y");
  return runJson(BIN, args).then((r) => unwrap(r));
}

/** Set isolated leverage for the hedge (don't cross-margin against unrelated balance). */
export function setLeverage(n: number): Promise<unknown> {
  return runJson(BIN, ["position", "leverage", "SOL", String(n), "--isolated"]).then((r) => unwrap(r));
}
