/**
 * Replay harness — drives a synthetic SOL swing through the REAL pure-math loop
 * (clmm-delta → size-hedge → decideRebalance → accounting) and emits a decision log.
 *
 * This is the demo engine: it needs NO live CLIs, no agent-token, no Mantle contract
 * — it exercises exactly the code paths the live agent uses, just with a simulated
 * price feed. It produces the artifact the dashboard reads: a timeline showing the
 * agent holding senior delta-neutral through the swing, with every decision logged.
 *
 * Honest framing (CLAUDE.md demo rules): qualitative — "watch it hold delta-neutral
 * through a swing." We do NOT emit a "senior is X% safe" number; the sim under-models
 * gap/range-exit risk (design §9).
 *
 *   tsx sim/replay.ts [--senior 6000] [--junior 4000] [--entry 150] [--width 0.15]
 *                     [--wake 60] [--seed 7] [--out config/replay.json] [-o json]
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs, num } from "../scripts/io.js";
import { makePricePath, sampleEvery } from "./price-path.js";
import { trancheParams } from "../lib/hc-curve.js";
import { lpDeltaSolFromNotional, clmmSolFraction, isInRange } from "../lib/clmm-delta.js";
import { targetShort, fundingClassification } from "../lib/size-hedge.js";
import { decideRebalance, DEFAULT_THRESHOLD } from "../lib/rebalance.js";
import { settlePeriod } from "../lib/accounting.js";
import { yearFraction } from "../lib/decimal.js";
import type { RebalanceDecision } from "../lib/types.js";

const argv = parseArgs();
const seniorCapUsd = num(argv.flags, "senior", 6000);
const juniorCapUsd = num(argv.flags, "junior", 4000);
const entry = num(argv.flags, "entry", 150);
const width = num(argv.flags, "width", 0.18); // ±18% band — calmer demo, fewer range-exits
const wake = num(argv.flags, "wake", 30); // wake every 30 min of sim time
const days = num(argv.flags, "days", 10);
const vol = num(argv.flags, "vol", 0.55); // moderate swing for a clean "hold delta-neutral" story
const seed = num(argv.flags, "seed", 3);
const threshold = num(argv.flags, "threshold", DEFAULT_THRESHOLD);
const outPath = String(argv.flags.out ?? new URL("../config/replay.json", import.meta.url).pathname);

const allocation = { seniorCapUsd, juniorCapUsd };
const params = trancheParams(allocation);
const range = { lower: entry * (1 - width), upper: entry * (1 + width) };
const lpNotionalUsd = seniorCapUsd + juniorCapUsd;

// A modest funding regime: a slow sine around +5% annualized (carry-positive most of
// the time, dips negative — exercises the carry/cost classifier honestly).
const fundingAt = (i: number, n: number) => 0.05 + 0.08 * Math.sin((i / n) * Math.PI * 3);

const full = makePricePath({ p0: entry, seed, annVol: vol, steps: days * 24 * 60 });
const wakes = sampleEvery(full, wake);

interface Frame extends RebalanceDecision {
  deltaSol: number;
  fundingAnnualized: number;
  juniorBufferUsd: number;
  seniorPaidToDateUsd: number;
  unhedgedSeniorUsd: number; // residual senior $ exposure = tracking error
}

const frames: Frame[] = [];
let currentShortSol = targetShort(
  lpDeltaSolFromNotional(wakes[0]!.price, range, lpNotionalUsd),
  params.seniorShare,
  params.h,
  wakes[0]!.price,
).shortSol.toNumber(); // start perfectly hedged

let juniorBufferUsd = juniorCapUsd;
let seniorPaidToDateUsd = 0;
let lastSettleTs = wakes[0]!.ts;
let rebalances = 0;

for (let i = 0; i < wakes.length; i++) {
  const { ts, price } = wakes[i]!;
  const deltaSol = lpDeltaSolFromNotional(price, range, lpNotionalUsd);
  const solFraction = clmmSolFraction(price, range);
  const tgt = targetShort(deltaSol, params.seniorShare, params.h, price);
  const fundingAnnualized = fundingAt(i, wakes.length);

  const decision = decideRebalance({
    ts,
    price,
    range,
    solFraction,
    currentShortSol,
    targetShortSol: tgt.shortSol.toNumber(),
    funding: { fundingRateAnnualized: fundingAnnualized },
    threshold,
  });

  // tracking error BEFORE acting: senior $ left unhedged this step
  const unhedgedSeniorUsd = Math.abs(currentShortSol - tgt.shortSol.toNumber()) * price;

  if (decision.action === "rebalance" || decision.action === "re-range") {
    currentShortSol = tgt.shortSol.toNumber();
    rebalances++;
  }

  // periodic accounting settle (~daily of sim time)
  const dt = yearFraction(lastSettleTs, ts);
  if (dt.toNumber() > 0) {
    const seniorFeesUsd = seniorCapUsd * 0.06 * dt.toNumber(); // 6% fee APR pro-rata
    const fundingUsd = tgt.shortUsd.toNumber() * fundingAnnualized * dt.toNumber();
    const seniorIlUsd = unhedgedSeniorUsd * 0.02 * dt.toNumber() * 365; // crude IL leak proxy
    const s = settlePeriod({
      seniorCapUsd,
      couponAnnual: params.c,
      dtYears: dt,
      seniorFeesUsd,
      fundingUsd,
      seniorIlUsd,
      juniorBufferUsd,
    });
    juniorBufferUsd = s.juniorBufferEndUsd;
    seniorPaidToDateUsd += s.seniorPaidUsd;
    lastSettleTs = ts;
  }

  frames.push({
    ...decision,
    deltaSol,
    fundingAnnualized,
    juniorBufferUsd,
    seniorPaidToDateUsd,
    unhedgedSeniorUsd,
  });
}

const carryFrames = frames.filter((f) => fundingClassification({ fundingRateAnnualized: f.fundingAnnualized }) === "carry").length;
const rangeExits = frames.filter((f) => !isInRange(f.price, range)).length;
const peakUnhedged = Math.max(...frames.map((f) => f.unhedgedSeniorUsd));

const artifact = {
  meta: {
    generatedFromSeed: seed,
    network: "testnet-sim",
    allocation,
    params,
    range,
    entry,
    thresholdT: threshold,
    wakeIntervalMin: wake,
    wakes: wakes.length,
    note: "Synthetic price path (sim/rebalance_sim.py process). Qualitative demo only — NOT a safety guarantee. Gap/range-exit risk is under-modeled (design §9).",
  },
  summary: {
    rebalances,
    rebalancePerWake: rebalances / wakes.length,
    rangeExitWakes: rangeExits,
    carryWakes: carryFrames,
    peakUnhedgedSeniorUsd: peakUnhedged,
    finalJuniorBufferUsd: juniorBufferUsd,
    seniorPaidToDateUsd,
    minPrice: Math.min(...frames.map((f) => f.price)),
    maxPrice: Math.max(...frames.map((f) => f.price)),
  },
  frames,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

if (argv.json) {
  process.stdout.write(JSON.stringify(artifact.summary, null, 2) + "\n");
} else {
  const s = artifact.summary;
  console.log(`Replay: ${wakes.length} wakes, SOL ${s.minPrice.toFixed(1)}–${s.maxPrice.toFixed(1)} (entry ${entry})`);
  console.log(`  rebalances: ${s.rebalances} (${(s.rebalancePerWake * 100).toFixed(1)}% of wakes)  range-exits: ${s.rangeExitWakes}`);
  console.log(`  funding-carry wakes: ${s.carryWakes}/${wakes.length}  peak unhedged senior: $${s.peakUnhedgedSeniorUsd.toFixed(0)}`);
  console.log(`  junior buffer: $${juniorCapUsd} → $${s.finalJuniorBufferUsd.toFixed(0)}  senior coupon paid: $${s.seniorPaidToDateUsd.toFixed(2)}`);
  console.log(`  artifact → ${outPath}`);
}
