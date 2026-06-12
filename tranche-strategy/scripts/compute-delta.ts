/**
 * Compute the LP delta (SOL) for the current cycle.
 *
 * Live:   reads `byreal-cli positions analyze` (delta proxy = SOL token amount).
 *   tsx scripts/compute-delta.ts --pos <ref> [-o json]
 * Offline (no CLI): derive from price/range/notional.
 *   tsx scripts/compute-delta.ts --price 150 --low 127.5 --high 172.5 --notional 10000 [-o json]
 */
import { parseArgs, num, emit } from "./io.js";
import { clmmSolFraction, lpDeltaSolFromNotional } from "../lib/clmm-delta.js";
import { positionAnalyze } from "../adapters/byreal-clmm.js";
import { CliUnavailableError } from "../adapters/exec.js";

const argv = parseArgs();

async function main() {
  if (argv.flags.pos) {
    const lp = await positionAnalyze(String(argv.flags.pos));
    const fraction = clmmSolFraction(lp.price, lp.range);
    return { source: "live", deltaSol: lp.solAmount, fraction, price: lp.price, inRange: lp.inRange };
  }
  const price = num(argv.flags, "price");
  const range = { lower: num(argv.flags, "low"), upper: num(argv.flags, "high") };
  const notional = num(argv.flags, "notional");
  const fraction = clmmSolFraction(price, range);
  return {
    source: "derived",
    deltaSol: lpDeltaSolFromNotional(price, range, notional),
    fraction,
    price,
    inRange: price >= range.lower && price <= range.upper,
  };
}

try {
  const r = await main();
  emit(argv, r, () => {
    console.log(`delta ≈ ${r.deltaSol.toFixed(4)} SOL  (SOL value-fraction ${(r.fraction * 100).toFixed(1)}%, price ${r.price}, ${r.inRange ? "in range" : "OUT OF RANGE"})`);
  });
} catch (e) {
  if (e instanceof CliUnavailableError) {
    console.error(`[blocked] ${e.message}\nFall back to offline mode: --price --low --high --notional`);
    process.exit(2);
  }
  throw e;
}
