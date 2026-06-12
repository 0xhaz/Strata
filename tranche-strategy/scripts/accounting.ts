/**
 * Settle one accounting period: senior coupon vs realized, junior buffer flow.
 *   tsx scripts/accounting.ts --senior-cap 6000 --c 0.03 --dt 0.5 \
 *       --fees 50 --funding 10 --il 5 --buffer 4000 [-o json]
 * With only --fees/--funding/--il it pulls seniorCap/c/buffer from state.json.
 */
import { parseArgs, num, emit } from "./io.js";
import { settlePeriod } from "../lib/accounting.js";
import { readState, updateState } from "../state/store.js";

const argv = parseArgs();

async function resolve() {
  const state = argv.flags["senior-cap"] === undefined ? await readState() : null;
  const seniorCapUsd = num(argv.flags, "senior-cap", state?.allocation.seniorCapUsd);
  const couponAnnual = num(argv.flags, "c", state?.params.c);
  const juniorBufferUsd = num(argv.flags, "buffer", state?.accounting.juniorBufferUsd);
  return {
    seniorCapUsd,
    couponAnnual,
    dtYears: num(argv.flags, "dt"),
    seniorFeesUsd: num(argv.flags, "fees"),
    fundingUsd: num(argv.flags, "funding", 0),
    seniorIlUsd: num(argv.flags, "il", 0),
    juniorBufferUsd,
    persist: !!state,
  };
}

const p = await resolve();
const s = settlePeriod(p);

if (p.persist) {
  await updateState((st) => {
    st.accounting.juniorBufferUsd = s.juniorBufferEndUsd;
    st.accounting.couponPaidToDateUsd += s.seniorPaidUsd;
    st.accounting.lastSettleTs = Date.now();
  });
}

emit(argv, s, () => {
  console.log(`coupon owed $${s.couponOwedUsd.toFixed(2)}  realized $${s.seniorRealizedUsd.toFixed(2)}`);
  if (s.excessUsd > 0) console.log(`  excess $${s.excessUsd.toFixed(2)} → junior keeps it (buffer → $${s.juniorBufferEndUsd.toFixed(2)})`);
  if (s.shortfallUsd > 0) console.log(`  shortfall $${s.shortfallUsd.toFixed(2)} → junior buffer absorbs (→ $${s.juniorBufferEndUsd.toFixed(2)})`);
  console.log(`  senior paid $${s.seniorPaidUsd.toFixed(2)}${s.bufferBreached ? `  ⚠️ BUFFER BREACHED — $${s.uncoveredUsd.toFixed(2)} uncovered, senior no longer fully protected` : ""}`);
});
