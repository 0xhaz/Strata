import { describe, it, expect } from "vitest";
import { decodeFunctionData } from "viem";
import { unwrap, parseNum, parsePct, pickNum } from "../adapters/byreal-json.js";
import { normalizeLpState } from "../adapters/byreal-clmm.js";
import { buildLogTx, DECISION_LOG_ABI } from "../adapters/mantle-log.js";
import type { RebalanceDecision } from "../lib/types.js";

// Real captured fixtures from byreal-cli 0.3.6 / byreal-perps-cli 0.3.7 (2026-06-10).

const SIGNAL_DETAIL = {
  success: true,
  meta: { timestamp: "2026-06-10T16:42:15.855Z", version: "0.3.7" },
  data: {
    coin: "SOL",
    price: "64.85",
    funding: "-0.0000026338",
    fundingAnnualized: "-2.3%",
    openInterest: "$3.92M",
    oraclePrice: "64.885",
  },
};

// A real position object from `positions top-positions` — note: NO token-amount field.
const POSITION = {
  poolAddress: "9GTj99g9tbz9U6UYDsX6YeRTgUnkYG6GTnHv3qLa5aXq",
  nftMintAddress: "AKBb2fp2s67nt6z7iuUfcJfqaNRFZWyHAydh5nS1mTtS",
  liquidityUsd: "6386.751490046400616375",
  earnedUsd: "151.763071260660006448",
  inRange: false,
  priceLower: "99.99002302966851587",
  priceUpper: "146.97333159378997279",
  pair: "SOL/USDC",
};

describe("envelope unwrap", () => {
  it("returns .data and tolerates already-unwrapped payloads", () => {
    expect(unwrap<{ coin: string }>(SIGNAL_DETAIL).coin).toBe("SOL");
    expect(unwrap<{ x: number }>({ x: 1 }).x).toBe(1);
  });
  it("throws on success:false", () => {
    expect(() => unwrap({ success: false, data: {} })).toThrow();
  });
});

describe("parseNum — strings, $, commas, K/M/B suffixes", () => {
  it("plain numeric strings", () => {
    expect(parseNum("64.85")).toBeCloseTo(64.85, 6);
    expect(parseNum(64.85)).toBe(64.85);
  });
  it("money with magnitude suffix", () => {
    expect(parseNum("$3.92M")).toBeCloseTo(3_920_000, 0);
    expect(parseNum("1,234")).toBe(1234);
    expect(parseNum("2.5K")).toBe(2500);
  });
  it("rejects percent strings (those go through parsePct) and junk", () => {
    expect(parseNum("44.27%")).toBeUndefined();
    expect(parseNum("n/a")).toBeUndefined();
    expect(parseNum(undefined)).toBeUndefined();
  });
});

describe("parsePct — percent string → fractional", () => {
  it("handles sign and magnitude", () => {
    expect(parsePct("-2.3%")).toBeCloseTo(-0.023, 9);
    expect(parsePct("44.27%")).toBeCloseTo(0.4427, 9);
  });
});

describe("signal-detail field mapping (the funding read)", () => {
  it("maps the wrapped, %-suffixed funding correctly", () => {
    const d = unwrap<Record<string, unknown>>(SIGNAL_DETAIL);
    expect(parsePct(d.fundingAnnualized)).toBeCloseTo(-0.023, 9); // a COST for a short
    expect(parseNum(d.price)).toBeCloseTo(64.85, 6);
    expect(parseNum(d.openInterest)).toBeCloseTo(3_920_000, 0);
    expect(pickNum(d, "price", "oraclePrice")).toBeCloseTo(64.85, 6);
  });
});

describe("normalizeLpState — DERIVED delta proxy (no token-amount field in CLI)", () => {
  it("derives SOL amount from liquidityUsd + range + price; mass-balances", () => {
    const price = 120; // in range [99.99, 146.97]
    const lp = normalizeLpState(POSITION, price);
    expect(lp.nftMint).toBe("AKBb2fp2s67nt6z7iuUfcJfqaNRFZWyHAydh5nS1mTtS");
    expect(lp.range.lower).toBeCloseTo(99.99002303, 6);
    expect(lp.range.upper).toBeCloseTo(146.97333159, 6);
    expect(lp.solAmount).toBeGreaterThan(0);
    // value of derived SOL + USDC reconstructs the position notional
    expect(lp.solAmount * price + lp.usdcAmount).toBeCloseTo(6386.75149, 2);
    expect(lp.feesAccruedUsd).toBeCloseTo(151.76307, 4);
  });

  it("prefers an explicit token amount if a future CLI provides one", () => {
    const lp = normalizeLpState({ ...POSITION, amountA: "12.5" }, 120);
    expect(lp.solAmount).toBeCloseTo(12.5, 6);
  });

  it("at/above range-high the derived SOL fraction is ~zero", () => {
    const lp = normalizeLpState(POSITION, 200);
    expect(lp.solAmount).toBeCloseTo(0, 6);
  });
});

describe("buildLogTx — UNSIGNED Mantle DecisionLog calldata (rule 1: never signs)", () => {
  const decision: RebalanceDecision = {
    ts: 1_700_000_000_000,
    action: "rebalance",
    reason: "Drift 10.00% > T 6.0% — resize short.",
    price: 64.85,
    solFraction: 0.46,
    currentShortSol: 24,
    targetShortSol: 26.4,
    driftPct: 0.1,
    thresholdPct: 0.06,
    funding: { annualized: -0.023, carryOrCost: "cost" },
  };
  const cfg = { agentId: 42n, contract: "0x00000000000000000000000000000000000000aa" as const, chainId: 5003 };

  it("builds a deterministic unsigned tx with zero value", () => {
    const tx = buildLogTx(decision, cfg);
    expect(tx.to).toBe(cfg.contract);
    expect(tx.value).toBe(0n);
    expect(tx.chainId).toBe(5003);
    expect(tx.data.startsWith("0x")).toBe(true);
    expect(buildLogTx(decision, cfg).data).toBe(tx.data); // deterministic
  });

  it("round-trips the decision fields through the ABI (fixed-point e6 / bps)", () => {
    const { data } = buildLogTx(decision, cfg);
    const decoded = decodeFunctionData({ abi: DECISION_LOG_ABI, data });
    expect(decoded.functionName).toBe("logDecision");
    const [agentId, ts, action, priceE6, targetE6, currentE6, driftBps, fundingBps, reason] =
      decoded.args as readonly [bigint, bigint, string, bigint, bigint, bigint, number, number, string];
    expect(agentId).toBe(42n);
    expect(ts).toBe(1_700_000_000n); // ms → seconds
    expect(action).toBe("rebalance");
    expect(priceE6).toBe(64_850_000n);
    expect(targetE6).toBe(26_400_000n);
    expect(currentE6).toBe(24_000_000n);
    expect(driftBps).toBe(1000); // 10%
    expect(fundingBps).toBe(-230); // -2.3%
    expect(reason).toContain("Drift");
  });
});
