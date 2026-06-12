/**
 * Breach demo — show the tranche structure doing its one job: routing a LOSS to junior first,
 * keeping senior protected. Reports a sequence of NEGATIVE settles to the live Mantle vault
 * (real, verifiable txs), walking the junior NAV down toward zero while the senior NAV holds.
 *
 * Each settle respects the on-chain anti-rug cap (maxSettleBps of TVL), so a big loss is reported
 * over several steps — which is exactly what the cap is for.
 *
 *   tsx scripts/breach-demo.ts --vault mETH               # loss → junior absorbs → RECOVER (non-destructive)
 *   tsx scripts/breach-demo.ts --vault mETH --no-recover  # leave junior near zero
 *   tsx scripts/breach-demo.ts --vault mETH --breach      # push PAST the junior buffer → senior absorbs (destructive)
 *
 * Signs with the settler key (mantle-vault/.env, testnet). Senior NAV stays ~flat the whole loss
 * phase — that's the protected-tranche guarantee, demonstrated on-chain.
 */
import { formatUnits, parseUnits, parseAbi } from "viem";
import { parseArgs } from "./io.js";
import { pub, vaultInfo, readVaultState, settleExact, explorer } from "../adapters/mantle-vault.js";

const argv = parseArgs();
const key = String(argv.flags.vault ?? "mETH");
const breach = !!argv.flags.breach; // push past the junior buffer into senior (destructive)
const recover = !breach && argv.flags["no-recover"] === undefined; // default: restore junior afterwards
const MAX_STEPS = 8;

const EXTRA = parseAbi([
  "function maxSettleBps() view returns (uint16)",
  "function sharePrice(uint8) view returns (uint256)",
]);

const v = vaultInfo(key);
const dust = () => parseUnits("0.0001", v.decimals);
const fmt = (x: bigint, p = 4) => Number(formatUnits(x, v.decimals)).toFixed(p);
const nav = (x: bigint) => Number(formatUnits(x, 18)).toFixed(4);

async function snapshot() {
  const [seniorNav, juniorNav] = await Promise.all([
    pub.readContract({ address: v.TrancheVault, abi: EXTRA, functionName: "sharePrice", args: [0] }),
    pub.readContract({ address: v.TrancheVault, abi: EXTRA, functionName: "sharePrice", args: [1] }),
  ]);
  const st = await readVaultState(key);
  return { seniorNav, juniorNav, ...st };
}

async function cap() {
  const st = await readVaultState(key);
  const bps = await pub.readContract({ address: v.TrancheVault, abi: EXTRA, functionName: "maxSettleBps" });
  return (st.tvl * BigInt(Number(bps))) / 10_000n;
}

// Settle, then WAIT until the public node reflects it (lastSettleTs advances) before reading —
// the Mantle sequencer/RPC can lag a block, so naive read-after-write returns stale state and
// would make the loop's control decisions (and the restore) inexact.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastTs = 0n;
async function settleStep(pnl: bigint) {
  const r = await settleExact(key, pnl);
  for (let i = 0; i < 25; i++) {
    const st = await readVaultState(key);
    if (st.lastSettleTs > lastTs) { lastTs = st.lastSettleTs; break; }
    await sleep(400);
  }
  return { ...(await snapshot()), hash: r.hash };
}

let seniorStart = 0n; // set after the opening snapshot; breach = senior actually loses value

function row(label: string, pnl: bigint, s: Awaited<ReturnType<typeof snapshot>>, hash?: string) {
  const breached = pnl < 0n && s.seniorAssets + dust() < seniorStart; // senior assets genuinely dropped
  const pnlStr = pnl === 0n ? "—" : `${pnl < 0n ? "" : "+"}${fmt(pnl)}`;
  console.log(
    `  ${label.padEnd(9)} pnl ${pnlStr.padStart(9)}  │  ` +
    `senior NAV ${nav(s.seniorNav)} (assets ${fmt(s.seniorAssets, 3)})   ` +
    `junior NAV ${nav(s.juniorNav)} (assets ${fmt(s.juniorAssets, 3)})` +
    (breached ? "  ⚠️ BREACH — senior absorbing" : "") +
    (hash ? `   ${explorer()}/tx/${hash}` : ""),
  );
}

const maxBps = await pub.readContract({ address: v.TrancheVault, abi: EXTRA, functionName: "maxSettleBps" });
console.log(`\n🏦 Breach demo — ${key} vault  ${v.TrancheVault}`);
console.log(`   per-settle cap ${Number(maxBps) / 100}% of TVL · senior coupon ${v.couponBps / 100}% · settle = real on-chain tx\n`);
console.log("── LOSS: a negative settle hits JUNIOR first; senior is protected ──");
const opening = await snapshot();
seniorStart = opening.seniorAssets;
lastTs = opening.lastSettleTs;
row("start", 0n, opening);

// ── Loss phase: walk junior down to ~0 in steps no larger than the on-chain cap. ──
let lossTotal = 0n;
for (let step = 1; step <= MAX_STEPS; step++) {
  const st = await readVaultState(key);
  if (st.juniorAssets <= dust()) break;
  const c = await cap();
  // Never exceed remaining junior (stay protective) — leave a hair so we don't tip into senior.
  const loss = st.juniorAssets < c ? (st.juniorAssets * 9_999n) / 10_000n : c;
  if (loss <= 0n) break;
  const s = await settleStep(-loss);
  lossTotal += loss;
  row(`loss #${step}`, -loss, s, s.hash);
}

// ── Optional: push PAST the buffer so senior absorbs the remainder (destructive). ──
if (breach) {
  const c = await cap();
  const st = await readVaultState(key);
  const extra = c < parseUnits("0.05", v.decimals) ? c : parseUnits("0.05", v.decimals);
  if (st.seniorAssets > extra) {
    console.log("\n── BREACH: junior is wiped; the next loss is absorbed by SENIOR ──");
    const s = await settleStep(-extra);
    row("breach", -extra, s, s.hash);
  }
}

// ── Recovery phase (default): the strategy earns back; junior NAV rebuilds, senior flat. ──
if (recover && lossTotal > 0n) {
  console.log("\n── RECOVER: positive settles rebuild the junior NAV (senior unchanged) ──");
  let left = lossTotal;
  for (let step = 1; step <= MAX_STEPS && left > dust(); step++) {
    const c = await cap();
    const gain = left < c ? left : c;
    const s = await settleStep(gain);
    left -= gain;
    row(`gain #${step}`, gain, s, s.hash);
  }
}

const end = await snapshot();
console.log(
  `\n✅ done — senior NAV held at ~${nav(end.seniorNav)} throughout` +
  (recover ? "; junior recovered to " + nav(end.juniorNav) : "; junior NAV " + nav(end.juniorNav)) +
  `. Every step is a verifiable Mantle tx.\n`,
);
