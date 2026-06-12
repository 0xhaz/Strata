/**
 * Working-state schema. OpenClaw memory + this local JSON hold the agent's state
 * between wake cycles — we do NOT build a database (CLAUDE.md don't-overbuild rule).
 * The on-chain log is the immutable public record; this file is mutable working state.
 */
import type { Range, SleeveAllocation, TrancheParams, RebalanceDecision } from "../lib/types.js";

export interface AgentState {
  version: 1;
  network: "testnet"; // CLAUDE.md hard rule 4 — testnet only until told otherwise
  allocation: SleeveAllocation;
  params: TrancheParams;
  pool: {
    address: string;
    range: Range;
    entryPrice: number;
    lpNftMint: string | null;
    lpNotionalUsd: number;
  };
  hedge: {
    coin: "SOL";
    dex: "main";
    currentShortSol: number; // signed magnitude we track; short stored as positive size
    lastTargetShortSol: number;
  };
  accounting: {
    juniorBufferUsd: number;
    couponPaidToDateUsd: number;
    lastSettleTs: number | null;
  };
  thresholdT: number;
  lastRebalanceTs: number | null;
  lastCycleTs: number | null;
  lastDecision: RebalanceDecision | null;
}

export function emptyState(allocation: SleeveAllocation, params: TrancheParams): AgentState {
  return {
    version: 1,
    network: "testnet",
    allocation,
    params,
    pool: {
      address: "",
      range: { lower: 0, upper: 0 },
      entryPrice: 0,
      lpNftMint: null,
      lpNotionalUsd: allocation.seniorCapUsd + allocation.juniorCapUsd,
    },
    hedge: { coin: "SOL", dex: "main", currentShortSol: 0, lastTargetShortSol: 0 },
    accounting: {
      juniorBufferUsd: allocation.juniorCapUsd,
      couponPaidToDateUsd: 0,
      lastSettleTs: null,
    },
    thresholdT: 0.06,
    lastRebalanceTs: null,
    lastCycleTs: null,
    lastDecision: null,
  };
}
