/**
 * Proof that a THIRD-PARTY wallet (not the authority) can deposit into the pool on the
 * current cluster: generate a fresh wallet, fund it with a little SOL + test-USDC, deposit
 * into the junior tranche, and report the pool + the wallet's new shares.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
 *     node_modules/.bin/ts-node app/demo-third-party.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TrancheVault } from "../target/types/tranche_vault";
import { getOrCreateAssociatedTokenAccount, mintTo, getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";

const JUNIOR = 1;
const USDC = (n: number) => new BN(n).mul(new BN(1_000_000));
const tvl = (p: { seniorAssets: BN; juniorAssets: BN }) => (p.seniorAssets.toNumber() + p.juniorAssets.toNumber()) / 1e6;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.trancheVault as Program<TrancheVault>;
  const authority = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), authority.publicKey.toBuffer()], program.programId)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], program.programId)[0];
  const juniorMint = PublicKey.findProgramAddressSync([Buffer.from("junior"), pool.toBuffer()], program.programId)[0];
  const usdcMint = (await program.account.pool.fetch(pool)).usdcMint;

  const demo = Keypair.generate();
  console.log("fresh demo wallet:", demo.publicKey.toBase58());

  // 1) Fund the demo wallet with a little SOL for fees + rent (from the authority wallet).
  const fund = new Transaction().add(SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: demo.publicKey, lamports: 0.05 * LAMPORTS_PER_SOL }));
  await sendAndConfirmTransaction(conn, fund, [authority.payer]);

  // 2) Faucet test-USDC to the demo wallet.
  const demoUsdc = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, usdcMint, demo.publicKey)).address;
  await mintTo(conn, authority.payer, usdcMint, demoUsdc, authority.publicKey, BigInt(USDC(500).toString()));
  console.log("faucet: 500 test-USDC →", demoUsdc.toBase58());

  // 3) Third-party deposit: the demo wallet signs its own deposit of 300 into JUNIOR.
  const before = await program.account.pool.fetch(pool);
  const demoShares = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, juniorMint, demo.publicKey)).address;
  const sig = await program.methods
    .deposit(JUNIOR, USDC(300))
    .accountsPartial({ user: demo.publicKey, pool, vault, trancheMint: juniorMint, userUsdc: demoUsdc, userShares: demoShares, tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID })
    .signers([demo])
    .rpc();
  const after = await program.account.pool.fetch(pool);
  const shares = Number((await getAccount(conn, demoShares)).amount) / 1e6;

  console.log(JSON.stringify({
    thirdPartyDeposit: true,
    signature: sig,
    demoWallet: demo.publicKey.toBase58(),
    juniorSharesReceived: shares,
    poolTvlBefore: tvl(before),
    poolTvlAfter: tvl(after),
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message ?? e); process.exit(1); });
