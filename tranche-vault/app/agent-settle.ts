/**
 * Agent → vault settle bridge. The off-chain agent (../tranche-strategy) computes the
 * period's realized strategy PnL (claimed LP fees + funding earned − IL borne, in USDC)
 * from its CLI reads + accounting, then reports it on-chain here so the vault NAV updates
 * from real results. This is the seam that connects the off-chain strategy to the on-chain
 * pooled vault.
 *
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
 *     node_modules/.bin/ts-node app/agent-settle.ts --pnl 150        # report +$150
 *     node_modules/.bin/ts-node app/agent-settle.ts --pnl -80 --dry-run
 *
 * The signer is the pool authority (the agent operator). For a real deployment the unsigned
 * tx would route through the agent-token handoff; here the local wallet signs on testnet.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TrancheVault } from "../target/types/tranche_vault";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const accrue = process.argv.includes("--accrue");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.trancheVault as Program<TrancheVault>;
  const authority = provider.wallet as anchor.Wallet;

  const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), authority.publicKey.toBuffer()], program.programId)[0];
  const p = await program.account.pool.fetch(pool);

  // --accrue: compute the period's realized PnL from on-chain time elapsed since the last
  // settle (stateless — ideal for an OpenClaw/cron tick). realized ≈ TVL × yieldApr × dt.
  // In production the agent supplies the live fee+funding APR from its byreal reads; here it
  // is a flag (default 6% LP-fee APR), so each tick books real accrued fees on-chain.
  let pnlUsd: number;
  if (accrue) {
    const tvl = (p.seniorAssets.toNumber() + p.juniorAssets.toNumber()) / 1e6;
    const yieldApr = Number(arg("fee-apr") ?? "0.06") + Number(arg("funding-apr") ?? "0");
    const nowSec = Math.floor(Date.now() / 1000);
    const dtYears = Math.max(0, nowSec - p.lastSettleTs.toNumber()) / 31_536_000;
    pnlUsd = tvl * yieldApr * dtYears;
  } else {
    pnlUsd = Number(arg("pnl"));
    if (!Number.isFinite(pnlUsd)) throw new Error("Pass --pnl <usd>, or --accrue to compute it from elapsed time.");
  }
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], program.programId)[0];
  const authorityUsdc = (await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, p.usdcMint, authority.publicKey)).address;

  const pnlBase = new BN(Math.round(pnlUsd * 1_000_000)); // USDC 6 decimals

  const builder = program.methods
    .settle(pnlBase)
    .accountsPartial({ authority: authority.publicKey, pool, vault, authorityUsdc, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID });

  if (dryRun) {
    const ix = await builder.instruction();
    console.log(JSON.stringify({
      action: "settle",
      realizedPnlUsd: pnlUsd,
      unsignedInstruction: { programId: ix.programId.toBase58(), keys: ix.keys.length, dataLenBytes: ix.data.length },
      note: "dry-run — build only. Hand to agent-token to sign + broadcast in production.",
    }, null, 2));
    return;
  }

  const sig = await builder.rpc();
  const after = await program.account.pool.fetch(pool);
  console.log(JSON.stringify({
    settled: true,
    realizedPnlUsd: pnlUsd,
    signature: sig,
    seniorAssetsUsd: after.seniorAssets.toNumber() / 1e6,
    juniorAssetsUsd: after.juniorAssets.toNumber() / 1e6,
    tvlUsd: (after.seniorAssets.toNumber() + after.juniorAssets.toNumber()) / 1e6,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
