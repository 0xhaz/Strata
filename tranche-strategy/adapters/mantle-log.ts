/**
 * On-chain decision log (Mantle) — the verifiability story (architecture §14, V-04).
 *
 * Two parts the hackathon conflates (architecture §14):
 *   1. ERC-8004 identity NFT — well-specified, canonical contracts. Low risk.
 *   2. Per-decision logging — ⛔ depends on whether the hackathon ships a logging
 *      contract/SDK. That address/ABI is behind participant onboarding (workplan
 *      Phase 0 [BLOCKER]); we do NOT invent it.
 *
 * Strategy so the demo still works today: every decision is appended to a local
 * append-only JSONL (the agent's verifiable journal). When the Mantle contract
 * address lands, `writeOnChain` emits the same record via viem and back-fills the
 * tx hash. The journal is honest about which records are anchored on-chain.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import type { RebalanceDecision } from "../lib/types.js";

export const DEFAULT_LOG_PATH = new URL("../config/decision-log.jsonl", import.meta.url)
  .pathname;

export interface LoggedDecision extends RebalanceDecision {
  onChain: { mantleTxHash: string | null; agentId: string | null };
}

/** Append a decision to the local journal. Always succeeds (off-chain mirror). */
export async function logDecision(
  decision: RebalanceDecision,
  path = DEFAULT_LOG_PATH,
): Promise<LoggedDecision> {
  const entry: LoggedDecision = {
    ...decision,
    onChain: { mantleTxHash: null, agentId: null }, // back-filled by writeOnChain
  };
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export async function readDecisionLog(path = DEFAULT_LOG_PATH): Promise<LoggedDecision[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LoggedDecision);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export class MantleLogUnavailableError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "MantleLogUnavailableError";
  }
}

// ── On-chain emit path: build the tx UNSIGNED, hand to a signer (rule 1). ──

export const DECISION_LOG_ABI = parseAbi([
  "function logDecision(uint256 agentId, uint64 ts, string action, int256 priceE6, int256 targetShortE6, int256 currentShortE6, int32 driftBps, int32 fundingBps, string reason)",
]);

export interface UnsignedEvmTx {
  to: Hex;
  data: Hex;
  value: bigint;
  chainId: number;
}

const e6 = (x: number) => BigInt(Math.round(x * 1e6));
const bps = (x: number) => Math.round(x * 10_000);

/**
 * Encode the calldata for one decision → an UNSIGNED EVM tx. Pure + deterministic
 * (no network), so it is unit-testable. Broadcast is the signer's job.
 */
export function buildLogTx(
  decision: RebalanceDecision,
  cfg: { agentId: bigint; contract: Hex; chainId: number },
): UnsignedEvmTx {
  const data = encodeFunctionData({
    abi: DECISION_LOG_ABI,
    functionName: "logDecision",
    args: [
      cfg.agentId,
      BigInt(Math.floor(decision.ts / 1000)),
      decision.action,
      e6(decision.price),
      e6(decision.targetShortSol),
      e6(decision.currentShortSol),
      bps(decision.driftPct),
      bps(decision.funding.annualized),
      decision.reason.slice(0, 256),
    ],
  });
  return { to: cfg.contract, data, value: 0n, chainId: cfg.chainId };
}

export interface MantleConfig {
  contract?: string; // env MANTLE_DECISION_LOG
  agentId?: string; // env ERC8004_AGENT_ID
  chainId?: number; // env MANTLE_CHAIN_ID
}

export function readMantleConfig(env = process.env): MantleConfig {
  return {
    contract: env.MANTLE_DECISION_LOG,
    agentId: env.ERC8004_AGENT_ID,
    chainId: env.MANTLE_CHAIN_ID ? Number(env.MANTLE_CHAIN_ID) : undefined,
  };
}

/**
 * Anchor a decision on Mantle. Builds the UNSIGNED tx and hands it to the signer
 * (agent-token / hackathon relayer). Until both the contract address and a signer
 * are wired, this throws and the caller keeps the local journal (no fabricated hash).
 */
export async function writeOnChain(
  decision: RebalanceDecision,
  cfg: MantleConfig = readMantleConfig(),
): Promise<{ txHash: string }> {
  if (!cfg.contract || cfg.agentId === undefined || cfg.chainId === undefined) {
    throw new MantleLogUnavailableError(
      "Mantle DecisionLog not configured. Deploy contracts/DecisionLog.sol and set " +
        "MANTLE_DECISION_LOG, ERC8004_AGENT_ID, MANTLE_CHAIN_ID. The unsigned tx is built " +
        "here; signing/broadcast is the agent-token handoff (never a local key).",
    );
  }
  // const tx = buildLogTx(decision, { agentId: BigInt(cfg.agentId), contract: cfg.contract as Hex, chainId: cfg.chainId });
  // return mantleSign(tx);  ← agent-token / relayer handoff (blocked until wired)
  throw new MantleLogUnavailableError(
    "DecisionLog configured but no Mantle signer wired (agent-token EVM handoff). " +
      "Unsigned tx is ready via buildLogTx(); broadcast pending the signer.",
  );
}
