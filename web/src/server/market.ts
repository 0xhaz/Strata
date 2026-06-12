/**
 * Server-only bridge to the Byreal CLIs and the tranche-strategy skill.
 *
 * We do NOT reimplement the CLIs — we shell out with `-o json` (the same path the
 * agent uses) and reuse the skill's VERIFIED parsing (`tranche-strategy/adapters/
 * byreal-json`, a pure module with no node builtins). Money-moving txs are built
 * UNSIGNED (`positions open --unsigned-tx`) for the agent-token handoff — the app
 * never signs (CLAUDE.md rule 1).
 */
import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { unwrap, parseNum, parsePct } from "@/lib/byreal-json";

const pexec = promisify(execFile);

// The skill lives next to web/ in the workspace.
const SKILL_DIR = join(process.cwd(), "..", "tranche-strategy");
const TSX = join(SKILL_DIR, "node_modules", ".bin", "tsx");

async function runJson<T>(bin: string, args: string[], timeoutMs = 45_000): Promise<T> {
  const { stdout } = await pexec(bin, [...args, "-o", "json"], {
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
}

export interface MarketSnapshot {
  pool: {
    id: string;
    pair: string;
    price: number;
    totalAprPct: number; // e.g. 44.27
    feeRateBps: number;
    tvlUsd: number;
  } | null;
  funding: {
    annualized: number; // fractional, signed
    classification: "carry" | "cost" | "flat";
    markPrice: number;
  } | null;
  errors: string[];
  fetchedAt: number;
}

/** Live SOL/USDC pool + SOL funding. Tolerates one venue being unreadable. */
export async function getMarket(): Promise<MarketSnapshot> {
  const errors: string[] = [];
  let pool: MarketSnapshot["pool"] = null;
  let funding: MarketSnapshot["funding"] = null;

  try {
    const data = unwrap<{ pools: Record<string, unknown>[] }>(
      await runJson("byreal-cli", ["pools", "list", "--sort-field", "apr24h"]),
    );
    const pools = Array.isArray(data) ? data : (data.pools ?? []);
    const sol = (pools as Record<string, unknown>[]).find((p) => p.pair === "SOL/USDC");
    if (sol) {
      pool = {
        id: String(sol.id ?? ""),
        pair: "SOL/USDC",
        price: parseNum(sol.current_price) ?? 0,
        totalAprPct: parseNum(sol.total_apr) ?? 0,
        feeRateBps: parseNum(sol.fee_rate_bps) ?? 0,
        tvlUsd: parseNum(sol.tvl_usd) ?? 0,
      };
    }
  } catch (e) {
    errors.push(`pool read: ${(e as Error).message.split("\n")[0]}`);
  }

  try {
    const d = unwrap<Record<string, unknown>>(await runJson("byreal-perps-cli", ["signal", "detail", "SOL"]));
    const ann = parsePct(d.fundingAnnualized) ?? 0;
    funding = {
      annualized: ann,
      classification: Math.abs(ann) <= 0.005 ? "flat" : ann > 0 ? "carry" : "cost",
      markPrice: parseNum(d.price) ?? parseNum(d.oraclePrice) ?? 0,
    };
  } catch (e) {
    errors.push(`funding read: ${(e as Error).message.split("\n")[0]}`);
  }

  return { pool, funding, errors, fetchedAt: Date.now() };
}

export interface DeployBuildInput {
  pool: string;
  priceLower: number;
  priceUpper: number;
  baseMint: string;
  amount: number;
  walletAddress: string;
}

/** Build the UNSIGNED open-position tx (RealClaw pattern). Never signs. */
export async function buildOpenUnsigned(o: DeployBuildInput): Promise<{ ok: boolean; unsignedTx?: unknown; error?: string }> {
  try {
    const raw = await runJson<unknown>("byreal-cli", [
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
    return { ok: true, unsignedTx: raw };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split("\n")[0] };
  }
}

export interface SimulateInput {
  senior: number;
  junior: number;
  entry: number;
  width: number;
}

/** Run the replay harness with the operator's split → regenerates config/replay.json. */
export async function runSimulate(o: SimulateInput): Promise<{ ok: boolean; summary?: unknown; error?: string }> {
  try {
    const { stdout } = await pexec(
      TSX,
      [
        "sim/replay.ts",
        "--senior", String(o.senior),
        "--junior", String(o.junior),
        "--entry", String(o.entry),
        "--width", String(o.width),
        "-o", "json",
      ],
      { cwd: SKILL_DIR, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return { ok: true, summary: JSON.parse(stdout) };
  } catch (e) {
    return { ok: false, error: (e as Error).message.split("\n")[0] };
  }
}
