/**
 * Initialize a demo pool on the current cluster: create a test-USDC mint, init the
 * pool, seed senior+junior deposits, run one settle, and print the web env config.
 *
 *   ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
 *     node_modules/.bin/ts-node app/init-pool.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TrancheVault } from "../target/types/tranche_vault";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { PublicKey, SystemProgram } from "@solana/web3.js";

const USDC = (n: number) => new BN(n).mul(new BN(1_000_000));

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.trancheVault as Program<TrancheVault>;
  const authority = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  const pda = (s: string, e: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from(s), e], program.programId)[0];
  const pool = pda("pool", authority.publicKey.toBuffer());
  const vault = pda("vault", pool.toBuffer());
  const seniorMint = pda("senior", pool.toBuffer());
  const juniorMint = pda("junior", pool.toBuffer());

  const usdcMint = await createMint(conn, authority.payer, authority.publicKey, null, 6);
  console.log("usdc mint:", usdcMint.toBase58());

  await program.methods
    .initializePool(287)
    .accountsPartial({
      authority: authority.publicKey,
      usdcMint,
      pool,
      vault,
      seniorMint,
      juniorMint,
      tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("pool initialized:", pool.toBase58());

  // Fund the authority with test USDC and seed both tranches (single wallet acts as the
  // first depositors so the demo shows non-zero TVL).
  const myUsdc = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, usdcMint, authority.publicKey)).address;
  await mintTo(conn, authority.payer, usdcMint, myUsdc, authority.publicKey, BigInt(USDC(20000).toString()));

  for (const [tranche, amt] of [[0, USDC(6000)], [1, USDC(4000)]] as const) {
    const mint = tranche === 0 ? seniorMint : juniorMint;
    const shares = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, mint, authority.publicKey)).address;
    await program.methods
      .deposit(tranche, amt)
      .accountsPartial({ user: authority.publicKey, pool, vault, trancheMint: mint, userUsdc: myUsdc, userShares: shares, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
      .rpc();
    console.log(`deposited ${amt.toString()} into tranche ${tranche}`);
  }

  // One settle with positive realized PnL so the junior NAV reflects a gain.
  await program.methods
    .settle(new BN(USDC(150).toString()))
    .accountsPartial({ authority: authority.publicKey, pool, vault, authorityUsdc: myUsdc, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
    .rpc();
  console.log("settled +150 realized PnL");

  console.log("\n--- web/.env.local ---");
  console.log(`NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899`);
  console.log(`NEXT_PUBLIC_VAULT_AUTHORITY=${authority.publicKey.toBase58()}`);
  console.log(`NEXT_PUBLIC_VAULT_USDC_MINT=${usdcMint.toBase58()}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
