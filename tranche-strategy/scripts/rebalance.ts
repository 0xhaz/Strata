/**
 * One wake cycle of the rebalance loop (tranche-design.md §5) — the highest-risk
 * logic. Driven by OpenClaw's native cron loop; we do NOT build a scheduler.
 *
 *   read BOTH venues → compute delta → target short → drift vs T → decide → log → persist
 *
 * Two-venue safety (design §6 [RISK]): if either Solana LP or Hyperliquid perp read
 * fails, we mark the cycle stale and HOLD — never act on half-current state.
 * Money-moving execution is gated behind --execute (default off) and still routes
 * every order through --dry-run, then the agent-token handoff for signing.
 */
import { parseArgs, emit } from "./io.js";
import { readState, updateState } from "../state/store.js";
import { lpDeltaSolFromNotional, clmmSolFraction } from "../lib/clmm-delta.js";
import { targetShort } from "../lib/size-hedge.js";
import { decideRebalance } from "../lib/rebalance.js";
import { positionAnalyze } from "../adapters/byreal-clmm.js";
import { signalDetail, positionList } from "../adapters/byreal-perps.js";
import { logDecision } from "../adapters/mantle-log.js";
import type { FundingSignal, LpState, PerpState } from "../lib/types.js";

const argv = parseArgs();
const state = await readState();
if (!state) throw new Error("No state — run scripts/init.ts first.");

// ── Two-venue read with explicit partial-failure handling ──
let lp: LpState | null = null;
let funding: FundingSignal | null = null;
let perps: PerpState[] | null = null;
const errors: string[] = [];

if (state.pool.lpNftMint) {
  try { lp = await positionAnalyze(state.pool.lpNftMint); }
  catch (e) { errors.push(`LP read: ${(e as Error).message}`); }
}
try { funding = await signalDetail("SOL"); }
catch (e) { errors.push(`funding read: ${(e as Error).message}`); }
try { perps = await positionList(); }
catch (e) { errors.push(`perp read: ${(e as Error).message}`); }

// Fall back to state-derived values where a venue is unread, but flag stale if a
// venue we EXPECTED to read failed — then the decision becomes skip-stale.
const price = lp?.price ?? state.pool.entryPrice;
const deltaSol = lp ? lp.solAmount : lpDeltaSolFromNotional(price, state.pool.range, state.pool.lpNotionalUsd);
const solFraction = clmmSolFraction(price, state.pool.range);
const fundingAnn = funding?.fundingRateAnnualized ?? 0;
const currentShortSol = perps
  ? Math.abs(perps.find((p) => p.coin === "SOL")?.sizeSol ?? 0)
  : state.hedge.currentShortSol;

const tgt = targetShort(deltaSol, state.params.seniorShare, state.params.h, price);
const stale = errors.length > 0 && (lp === null || funding === null || perps === null);

const decision = decideRebalance({
  ts: Date.now(),
  price,
  range: state.pool.range,
  solFraction,
  currentShortSol,
  targetShortSol: tgt.shortSol.toNumber(),
  funding: { fundingRateAnnualized: fundingAnn },
  threshold: state.thresholdT,
  stale,
});

// ── Journal every decision (verifiability story) ──
await logDecision(decision);

// ── Persist working state ──
await updateState((s) => {
  s.lastCycleTs = decision.ts;
  s.lastDecision = decision;
  s.hedge.lastTargetShortSol = tgt.shortSol.toNumber();
  if (decision.action === "rebalance") s.lastRebalanceTs = decision.ts;
});

// ── Execution is opt-in and dry-run-first; live signing is the agent-token handoff ──
let executed = false;
if (argv.flags.execute && decision.action === "rebalance") {
  // Intentionally NOT auto-firing here: the order build + dry-run + agent-token
  // signing handoff is wired in adapters/byreal-perps.ts + adapters/agent-token.ts.
  // Left as an explicit gate so a dry build never moves funds (CLAUDE.md rule 4).
  errors.push("execute requested but live signing requires the agent-token handoff (blocked dep).");
}

emit(argv, { ...decision, currentShortSol, targetShortSol: tgt.shortSol.toNumber(), executed, errors }, () => {
  console.log(`[${decision.action.toUpperCase()}] ${decision.reason}`);
  console.log(`  price ${price}  delta ${deltaSol.toFixed(3)} SOL  short ${currentShortSol.toFixed(3)}→${tgt.shortSol.toNumber().toFixed(3)}  drift ${(decision.driftPct * 100).toFixed(2)}%`);
  if (errors.length) console.log(`  notes: ${errors.join(" | ")}`);
});
