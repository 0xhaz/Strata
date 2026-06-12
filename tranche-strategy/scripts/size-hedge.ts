/**
 * Size the target short for the senior sleeve: target = h · seniorShare · delta.
 *   tsx scripts/size-hedge.ts --delta 30.9 --senior-share 0.6 --h 1.0 --price 150 [--funding 0.1] [-o json]
 * With no flags it reads from config/state.json + a live `signal detail SOL`.
 */
import { parseArgs, num, emit } from "./io.js";
import { targetShort, fundingClassification, fundingCarryUsd } from "../lib/size-hedge.js";
import { readState } from "../state/store.js";
import { signalDetail } from "../adapters/byreal-perps.js";
import { clmmSolFraction, lpDeltaSolFromNotional } from "../lib/clmm-delta.js";
import { CliUnavailableError } from "../adapters/exec.js";

const argv = parseArgs();

async function resolveInputs() {
  if (argv.flags.delta !== undefined) {
    return {
      deltaSol: num(argv.flags, "delta"),
      seniorShare: num(argv.flags, "senior-share"),
      h: num(argv.flags, "h"),
      price: num(argv.flags, "price"),
      fundingAnnualized: num(argv.flags, "funding", 0),
    };
  }
  const state = await readState();
  if (!state) throw new Error("No state — run scripts/init.ts first or pass explicit flags.");
  const price = num(argv.flags, "price", state.pool.entryPrice);
  let fundingAnnualized = num(argv.flags, "funding", NaN);
  if (Number.isNaN(fundingAnnualized)) {
    try {
      fundingAnnualized = (await signalDetail("SOL")).fundingRateAnnualized;
    } catch (e) {
      if (!(e instanceof CliUnavailableError)) throw e;
      fundingAnnualized = 0; // funding is upside-only; absence doesn't change the size
    }
  }
  const deltaSol = lpDeltaSolFromNotional(price, state.pool.range, state.pool.lpNotionalUsd);
  return { deltaSol, seniorShare: state.params.seniorShare, h: state.params.h, price, fundingAnnualized };
}

const inp = await resolveInputs();
const t = targetShort(inp.deltaSol, inp.seniorShare, inp.h, inp.price);
const carry = fundingClassification({ fundingRateAnnualized: inp.fundingAnnualized });
const carryUsd = fundingCarryUsd(t.shortUsd, { fundingRateAnnualized: inp.fundingAnnualized });

emit(
  argv,
  {
    targetShortSol: t.shortSol.toNumber(),
    targetShortUsd: t.shortUsd.toNumber(),
    inputs: inp,
    funding: { classification: carry, annualizedCarryUsd: carryUsd.toNumber() },
  },
  () => {
    console.log(`target short = ${t.shortSol.toNumber().toFixed(4)} SOL  ($${t.shortUsd.toNumber().toFixed(2)} notional)`);
    console.log(`  = h ${inp.h} · seniorShare ${inp.seniorShare} · delta ${inp.deltaSol.toFixed(4)} SOL`);
    console.log(`  funding ${carry} (${(inp.fundingAnnualized * 100).toFixed(2)}% ann → $${carryUsd.toNumber().toFixed(2)}/yr ${carry === "carry" ? "earned" : "paid"})`);
  },
);
