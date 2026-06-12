/**
 * Loads the replay artifact produced by `tranche-strategy/sim/replay.ts`.
 * Prefers the live artifact in the sibling skill's config/ dir; falls back to the
 * bundled snapshot so the dashboard always renders standalone.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sample from "@/data/replay.sample.json";

export type Action = "rebalance" | "hold" | "re-range" | "skip-stale";
export type Carry = "carry" | "cost" | "flat";

export interface Frame {
  ts: number;
  action: Action;
  reason: string;
  price: number;
  solFraction: number;
  currentShortSol: number;
  targetShortSol: number;
  driftPct: number;
  thresholdPct: number;
  funding: { annualized: number; carryOrCost: Carry };
  deltaSol: number;
  fundingAnnualized: number;
  juniorBufferUsd: number;
  seniorPaidToDateUsd: number;
  unhedgedSeniorUsd: number;
}

export interface ReplayArtifact {
  meta: {
    generatedFromSeed: number;
    network: string;
    allocation: { seniorCapUsd: number; juniorCapUsd: number };
    params: {
      juniorShare: number;
      seniorShare: number;
      h: number;
      c: number;
      protection: number;
    };
    range: { lower: number; upper: number };
    entry: number;
    thresholdT: number;
    wakeIntervalMin: number;
    wakes: number;
    note: string;
  };
  summary: {
    rebalances: number;
    rebalancePerWake: number;
    rangeExitWakes: number;
    carryWakes: number;
    peakUnhedgedSeniorUsd: number;
    finalJuniorBufferUsd: number;
    seniorPaidToDateUsd: number;
    minPrice: number;
    maxPrice: number;
  };
  frames: Frame[];
}

export async function loadReplay(): Promise<{ data: ReplayArtifact; live: boolean }> {
  const livePath = join(
    process.cwd(),
    "..",
    "tranche-strategy",
    "config",
    "replay.json",
  );
  try {
    const raw = await readFile(livePath, "utf8");
    return { data: JSON.parse(raw) as ReplayArtifact, live: true };
  } catch {
    return { data: sample as unknown as ReplayArtifact, live: false };
  }
}

export const fmtUsd = (n: number, dp = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
export const fmtPct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;
