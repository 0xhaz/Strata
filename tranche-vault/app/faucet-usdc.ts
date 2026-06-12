/**
 * Hand out the vault's test-USDC. Mints the pool's USDC mint (authority = the pool
 * authority, which controls the test mint) to any address so demo wallets can deposit.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
 *     node_modules/.bin/ts-node app/faucet-usdc.ts --to <recipient-pubkey> --amount 1000
 *
 * Only works while the authority is the test mint's mint-authority (true for pools created
 * by app/init-pool.ts). A real USDC deployment would point the vault at the canonical mint.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { TrancheVault } from "../target/types/tranche_vault";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg("to");
  const amountUsd = Number(arg("amount") ?? "1000");
  if (!to) throw new Error("Pass --to <recipient-pubkey>.");
  const recipient = new PublicKey(to);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.trancheVault as Program<TrancheVault>;
  const authority = provider.wallet as anchor.Wallet;

  const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), authority.publicKey.toBuffer()], program.programId)[0];
  const usdcMint = (await program.account.pool.fetch(pool)).usdcMint;

  const ata = (await getOrCreateAssociatedTokenAccount(provider.connection, authority.payer, usdcMint, recipient)).address;
  const base = BigInt(Math.round(amountUsd * 1_000_000));
  const sig = await mintTo(provider.connection, authority.payer, usdcMint, ata, authority.publicKey, base);

  console.log(JSON.stringify({
    minted: true,
    usdcMint: usdcMint.toBase58(),
    to: recipient.toBase58(),
    ata: ata.toBase58(),
    amountUsd,
    signature: sig,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
