/**
 * Autonomous wake loop (demo runner) — the agent acting on a schedule, streaming each
 * decision to a live feed the web dashboard polls.
 *
 * Each tick the agent autonomously:
 *   1. wakes (cron-style),
 *   2. reads BOTH Byreal skills LIVE — CLMM pool price (`byreal-cli`, the yield leg) and
 *      Hyperliquid funding (`byreal-perps-cli signal detail`, the hedge leg),
 *   3. computes the LP delta + the senior-hedge target,
 *   4. decides hold / rebalance / re-range / skip-stale (with rationale),
 *   5. journals the decision + publishes config/live.json (the dashboard's feed),
 *   6. paper-applies the hedge resize and sleeps to the next wake.
 *
 * Production drives the SAME cycle from OpenClaw/RealClaw's native cron (openclaw/wake-loop.md).
 * Money-moving execution is paper here; live signing is the agent-token handoff (rule 1).
 * Two-venue safety is real: a failed/zero live read → skip-stale (HOLD).
 *
 *   tsx scripts/agent-loop.ts [--ticks 8] [--interval 15] [--threshold 0.06]
 *                             [--notional 10000] [--senior-share 0.6] [--h 1.0] [--width 0.15]
 *   --ticks 0  → run forever (Ctrl+C to stop); watch it live at the web /live page.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs, num } from "./io.js";
import { readState, writeState } from "../state/store.js";
import { emptyState } from "../state/schema.js";
import { trancheParams } from "../lib/hc-curve.js";
import { clmmSolFraction, lpDeltaSolFromNotional } from "../lib/clmm-delta.js";
import { targetShort, fundingClassification } from "../lib/size-hedge.js";
import { decideRebalance } from "../lib/rebalance.js";
import { poolsList } from "../adapters/byreal-clmm.js";
import { signalDetail } from "../adapters/byreal-perps.js";
import { logDecision } from "../adapters/mantle-log.js";
import { settleAccrued } from "../adapters/mantle-vault.js";

const argv = parseArgs();
const ticks = num(argv.flags, "ticks", 8);
const intervalSec = num(argv.flags, "interval", 15);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LIVE_PATH = new URL("../config/live.json", import.meta.url).pathname;

const state =
  (await readState()) ??
  (() => {
    const total = num(argv.flags, "notional", 10000);
    const alloc = { seniorCapUsd: total * 0.6, juniorCapUsd: total * 0.4 };
    return emptyState(alloc, trancheParams(alloc));
  })();

// Default: delta-neutral mETH yield (the Mantle RWA play) — hold mETH (Mantle staked ETH, an
// RWA earning staking yield), hedge the ETH price on the Hyperliquid ETH perp (Ethena-style).
// Pass --pair for a Byreal CLMM asset (e.g. SOL/USDC, XAUt0/USDT) to use the LP/gamma mode.
const ASSET = String(argv.flags.asset ?? "mETH");
const PERP = String(argv.flags.perp ?? "ETH");
const PAIR = String(argv.flags.pair ?? "");
const SPOT = PAIR.length === 0; // no Byreal pool → spot RWA hold + perp hedge (linear delta)

// --settle: every N cycles, report the period's net yield to the Mantle vault on-chain
// (yield = staking APR + the LIVE funding the agent just read → genuinely data-driven).
const SETTLE = !!argv.flags.settle;
const SETTLE_VAULT = String(argv.flags["settle-vault"] ?? "mETH");
const SETTLE_EVERY = num(argv.flags, "settle-every", 4);
const STAKING_APR = num(argv.flags, "staking-apr", 0.035);

const seniorShare = num(argv.flags, "senior-share", state.params.seniorShare);
const h = num(argv.flags, "h", state.params.h);
const notionalUsd = num(argv.flags, "notional", state.pool.lpNotionalUsd);
const width = num(argv.flags, "width", 0.15);
const threshold = num(argv.flags, "threshold", state.thresholdT);
const startedAt = Date.now();

interface Cycle {
  i: number;
  ts: number;
  action: string;
  reason: string;
  price: number;
  fundingAnnualized: number;
  carry: "carry" | "cost" | "flat";
  deltaSol: number;
  currentShortSol: number;
  targetShortSol: number;
  driftPct: number;
  unhedgedUsd: number;
}
const cycles: Cycle[] = [];
let range = { lower: 0, upper: 0 };
let currentShortSol = 0;
let rebalances = 0;
let running = true;

async function publish() {
  const feed = {
    running,
    startedAt,
    lastUpdate: Date.now(),
    intervalSec,
    ticksTarget: ticks,
    asset: ASSET,
    config: {
      seniorShare,
      h,
      couponC: state.params.c,
      threshold,
      notionalUsd,
      juniorBufferUsd: notionalUsd * (1 - seniorShare),
      range,
    },
    summary: {
      cycles: cycles.length,
      rebalances,
      holds: cycles.filter((c) => c.action === "hold").length,
      skips: cycles.filter((c) => c.action === "skip-stale").length,
    },
    cycles,
  };
  await mkdir(dirname(LIVE_PATH), { recursive: true });
  await writeFile(LIVE_PATH, JSON.stringify(feed, null, 2) + "\n", "utf8");
}

async function readVenues(): Promise<{ price: number; fundingAnn: number } | null> {
  let price: number | undefined;
  let fundingAnn: number | undefined;
  try {
    const sig = await signalDetail(PERP); // hedge leg: funding (+ price reference in spot mode)
    fundingAnn = sig.fundingRateAnnualized;
    if (SPOT) price = sig.markPrice; // mETH ≈ ETH; the ETH perp mark is the price reference
  } catch {
    /* hedge leg unreadable */
  }
  if (!SPOT) {
    try {
      const pools = await poolsList();
      price = pools.find((p) => p.pair === PAIR)?.currentPrice; // CLMM yield leg (e.g. XAUt0/USDT)
    } catch {
      /* yield leg unreadable */
    }
  }
  if (price === undefined || price <= 0 || fundingAnn === undefined) return null;
  return { price, fundingAnn };
}

// Flush running:false on Ctrl+C so the dashboard shows "idle" promptly.
process.on("SIGINT", async () => {
  running = false;
  await publish().catch(() => {});
  process.exit(0);
});

console.log(`\n🤖 Tranche agent — autonomous wake loop (${ticks <= 0 ? "∞" : ticks} cycles, every ${intervalSec}s)`);
console.log(
  SPOT
    ? `   RWA: ${ASSET} staking yield, delta-hedged by the ${PERP} perp (Ethena-style, Mantle RWA)`
    : `   RWA: ${ASSET} (${PAIR} LP) delta-hedged by the ${PERP} perp`,
);
console.log(
  SPOT
    ? `   ${ASSET} staking (Mantle) + byreal-perps-cli (Hyperliquid hedge), live`
    : `   composing byreal-cli (CLMM yield) + byreal-perps-cli (Hyperliquid hedge), live`,
);
console.log(`   streaming to config/live.json → watch the web /live page\n`);
await publish();

for (let i = 1; ticks <= 0 || i <= ticks; i++) {
  const ts = Date.now();
  const venues = await readVenues();

  if (!venues) {
    const d = decideRebalance({
      ts, price: range.lower || 1, range: range.upper > 0 ? range : { lower: 0, upper: 1 },
      solFraction: 0, currentShortSol, targetShortSol: currentShortSol,
      funding: { fundingRateAnnualized: 0 }, threshold, stale: true,
    });
    await logDecision(d);
    cycles.push({ i, ts, action: "skip-stale", reason: d.reason, price: 0, fundingAnnualized: 0, carry: "flat", deltaSol: 0, currentShortSol, targetShortSol: currentShortSol, driftPct: 0, unhedgedUsd: 0 });
    await publish();
    console.log(`#${i} [SKIP-STALE] one venue unreadable — holding`);
    if (ticks <= 0 || i < ticks) await sleep(intervalSec * 1000);
    continue;
  }

  if (range.upper === 0) {
    range = SPOT
      ? { lower: venues.price * 0.001, upper: venues.price * 1000 } // spot hold: effectively unbounded
      : { lower: venues.price * (1 - width), upper: venues.price * (1 + width) };
  }
  // Spot RWA hold (mETH): full linear delta (100% long ETH), no CLMM gamma/range.
  const solFraction = SPOT ? 1 : clmmSolFraction(venues.price, range);
  const deltaSol = SPOT ? notionalUsd / venues.price : lpDeltaSolFromNotional(venues.price, range, notionalUsd);
  const tgt = targetShort(deltaSol, seniorShare, h, venues.price);
  const carry = fundingClassification({ fundingRateAnnualized: venues.fundingAnn });
  const unhedgedUsd = Math.abs(currentShortSol - tgt.shortSol.toNumber()) * venues.price;

  const decision = decideRebalance({
    ts, price: venues.price, range, solFraction,
    currentShortSol, targetShortSol: tgt.shortSol.toNumber(),
    funding: { fundingRateAnnualized: venues.fundingAnn }, threshold,
  });
  await logDecision(decision);

  if (decision.action === "rebalance" || decision.action === "re-range") {
    currentShortSol = tgt.shortSol.toNumber();
    rebalances++;
  }

  cycles.push({
    i, ts, action: decision.action, reason: decision.reason, price: venues.price,
    fundingAnnualized: venues.fundingAnn, carry, deltaSol,
    currentShortSol, targetShortSol: tgt.shortSol.toNumber(), driftPct: decision.driftPct, unhedgedUsd,
  });
  await publish();

  const tag =
    decision.action === "rebalance" ? "🔁 REBALANCE" :
    decision.action === "re-range" ? "📐 RE-RANGE " :
    decision.action === "hold" ? "✋ HOLD     " : "⏭️  SKIP     ";
  console.log(
    `#${i} ${tag} ${ASSET} $${venues.price.toFixed(2)}  funding ${(venues.fundingAnn * 100).toFixed(1)}% ${carry}  ` +
    `delta ${deltaSol.toFixed(2)} ${ASSET}  short ${currentShortSol.toFixed(2)}→tgt ${tgt.shortSol.toNumber().toFixed(2)}  ` +
    `drift ${(decision.driftPct * 100).toFixed(1)}%`,
  );

  // Report the period's realized yield to the Mantle vault on-chain (read → decide → settle).
  if (SETTLE && i % SETTLE_EVERY === 0) {
    const yieldApr = STAKING_APR + venues.fundingAnn; // staking + live funding carry
    try {
      const r = await settleAccrued(SETTLE_VAULT, yieldApr);
      console.log(`   ↳ reported +${r.pnl} ${SETTLE_VAULT} yield on Mantle · junior NAV ${r.juniorNav} · tx ${r.hash.slice(0, 12)}…`);
    } catch (e) {
      console.log(`   ↳ Mantle settle skipped (${(e as Error).message.slice(0, 60)})`);
    }
  }

  if (ticks <= 0 || i < ticks) await sleep(intervalSec * 1000);
}

running = false;
state.pool.range = range;
state.hedge.currentShortSol = currentShortSol;
state.lastCycleTs = Date.now();
await writeState(state);
await publish();
console.log(`\n✅ done — ${rebalances} rebalances over ${cycles.length} cycles. Streamed to config/live.json + journaled.\n`);
