/**
 * Append a decision to the verifiable journal (and anchor on Mantle when wired).
 * Reads a RebalanceDecision JSON from --file or stdin.
 *   tsx scripts/rebalance.ts -o json | tsx scripts/log-decision.ts [-o json]
 */
import { readFile } from "node:fs/promises";
import { parseArgs, emit } from "./io.js";
import { logDecision, writeOnChain, MantleLogUnavailableError } from "../adapters/mantle-log.js";
import type { RebalanceDecision } from "../lib/types.js";

const argv = parseArgs();

async function readInput(): Promise<RebalanceDecision> {
  if (argv.flags.file) return JSON.parse(await readFile(String(argv.flags.file), "utf8"));
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const decision = await readInput();
const entry = await logDecision(decision);

let anchored = false;
try {
  const { txHash } = await writeOnChain(decision);
  entry.onChain.mantleTxHash = txHash;
  anchored = true;
} catch (e) {
  if (!(e instanceof MantleLogUnavailableError)) throw e;
}

emit(argv, { logged: true, anchored, entry }, () => {
  console.log(`journaled ${decision.action} @ ${decision.price} — ${anchored ? `on-chain ${entry.onChain.mantleTxHash}` : "local journal (Mantle contract pending onboarding)"}`);
});
