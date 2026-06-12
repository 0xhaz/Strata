/**
 * Agent → Mantle settle (CLI). Reports each vault's net realized yield to the on-chain
 * TrancheVault(s) on Mantle, so the AI output is verifiable/auditable (AI×RWA).
 *
 *   tsx scripts/mantle-settle.ts --vault mETH --pnl 0.05      # one vault, explicit amount
 *   tsx scripts/mantle-settle.ts --all --accrue              # both vaults, time-accrued yield
 *   tsx scripts/mantle-settle.ts --all --accrue --loop --interval 120   # scheduled (cron-style)
 *   tsx scripts/mantle-settle.ts --vault USDY --pnl 0.5 --dry-run        # unsigned (agent-token)
 *
 * Signs with the vault owner key (mantle-vault/.env, testnet); --dry-run emits the unsigned tx
 * for the agent-token handoff (CLAUDE.md rule 1).
 */
import { parseUnits } from "viem";
import { parseArgs, num } from "./io.js";
import {
  vaultInfo, vaultKeys, settleExact, settleAccrued, unsignedSettle,
} from "../adapters/mantle-vault.js";

const argv = parseArgs();
const DEFAULT_APR: Record<string, number> = { mETH: 0.07, USDY: 0.05 };
const keys = argv.flags.all ? vaultKeys() : [String(argv.flags.vault ?? "mETH")];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function once(key: string) {
  const v = vaultInfo(key);
  if (argv.flags["dry-run"]) {
    const pnlBase = parseUnits(String(num(argv.flags, "pnl", 0.01)), v.decimals);
    console.log(JSON.stringify({ vault: key, ...unsignedSettle(key, pnlBase) }, null, 2));
    return;
  }
  const r = argv.flags.accrue || argv.flags.loop
    ? await settleAccrued(key, num(argv.flags, "apr", DEFAULT_APR[key] ?? 0.05))
    : await settleExact(key, parseUnits(String(num(argv.flags, "pnl")), v.decimals));
  console.log(`[${key}] settled +${r.pnl} ${v.symbol}  juniorNAV ${r.juniorNav}  tx ${r.hash.slice(0, 12)}…  ${r.status}`);
}

do {
  for (const key of keys) {
    try { await once(key); } catch (e) { console.error(`[${key}] ${(e as Error).message.split("\n")[0]}`); }
  }
  if (argv.flags.loop) await sleep(num(argv.flags, "interval", 120) * 1000);
} while (argv.flags.loop && !argv.flags["dry-run"]);
