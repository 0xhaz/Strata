/**
 * Initialize agent state from a capital split. Single-user capital only — the
 * senior/junior split is how the user divides their OWN funds (never pooled).
 *
 *   tsx scripts/init.ts --senior 6000 --junior 4000 --entry 150 --width 0.15 [-o json]
 */
import { parseArgs, num, emit } from "./io.js";
import { trancheParams } from "../lib/hc-curve.js";
import { emptyState } from "../state/schema.js";
import { writeState } from "../state/store.js";

const argv = parseArgs();
const seniorCapUsd = num(argv.flags, "senior");
const juniorCapUsd = num(argv.flags, "junior");
const entry = num(argv.flags, "entry");
const width = num(argv.flags, "width", 0.15);

const allocation = { seniorCapUsd, juniorCapUsd };
const params = trancheParams(allocation);
const state = emptyState(allocation, params);
state.pool.entryPrice = entry;
state.pool.range = { lower: entry * (1 - width), upper: entry * (1 + width) };

await writeState(state);

emit(argv, { ok: true, allocation, params, range: state.pool.range }, () => {
  console.log("Initialized tranche state (testnet):");
  console.log(`  senior $${seniorCapUsd}  junior $${juniorCapUsd}  jShare ${(params.juniorShare * 100).toFixed(1)}%`);
  console.log(`  h=${params.h.toFixed(2)}  c=${(params.c * 100).toFixed(2)}%  protection=${(params.protection * 100).toFixed(1)}%`);
  console.log(`  range [${state.pool.range.lower.toFixed(2)}, ${state.pool.range.upper.toFixed(2)}]  entry ${entry}`);
});
