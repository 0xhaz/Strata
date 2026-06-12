/**
 * Client for the tranche-vault Solana program. Reads pool state and builds
 * deposit/withdraw transactions signed by the connected wallet. The user signs
 * their OWN deposit — single-user-into-a-shared-pool, the pooled model.
 */
import {
  AnchorProvider,
  Program,
  BN,
} from "@coral-xyz/anchor";
import type { TrancheVault } from "@/idl/tranche_vault";
import {
  Connection,
  PublicKey,
  Transaction,
  type Signer,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import idlJson from "@/idl/tranche_vault.json";
import { VAULT_AUTHORITY, VAULT_USDC_MINT } from "@/lib/cluster";

const idl = idlJson as TrancheVault;
export const PROGRAM_ID = new PublicKey(idl.address);
export const SENIOR = 0;
export const JUNIOR = 1;
export const USDC_DECIMALS = 6;

export interface Pdas {
  pool: PublicKey;
  vault: PublicKey;
  seniorMint: PublicKey;
  juniorMint: PublicKey;
}

export function derivePdas(authority: PublicKey): Pdas {
  const pool = PublicKey.findProgramAddressSync([Buffer.from("pool"), authority.toBuffer()], PROGRAM_ID)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID)[0];
  const seniorMint = PublicKey.findProgramAddressSync([Buffer.from("senior"), pool.toBuffer()], PROGRAM_ID)[0];
  const juniorMint = PublicKey.findProgramAddressSync([Buffer.from("junior"), pool.toBuffer()], PROGRAM_ID)[0];
  return { pool, vault, seniorMint, juniorMint };
}

export function isConfigured(): boolean {
  return VAULT_AUTHORITY.length > 0 && VAULT_USDC_MINT.length > 0;
}

const READONLY_WALLET = {
  publicKey: PublicKey.default,
  signTransaction: async <T>(t: T) => t,
  signAllTransactions: async <T>(t: T[]) => t,
};

export function getProgram(connection: Connection, wallet?: unknown): Program<TrancheVault> {
  const provider = new AnchorProvider(connection, (wallet ?? READONLY_WALLET) as never, {
    commitment: "confirmed",
  });
  return new Program(idl, provider);
}

export interface PoolView {
  authority: string;
  couponBps: number;
  seniorAssets: number; // USDC
  juniorAssets: number;
  seniorShares: number;
  juniorShares: number;
  seniorSharePrice: number; // assets/shares
  juniorSharePrice: number;
  tvl: number;
  lastSettleTs: number;
}

const toUsdc = (v: BN) => v.toNumber() / 10 ** USDC_DECIMALS;

export async function fetchPool(connection: Connection): Promise<PoolView | null> {
  if (!isConfigured()) return null;
  const authority = new PublicKey(VAULT_AUTHORITY);
  const { pool } = derivePdas(authority);
  const program = getProgram(connection);
  try {
    const p = await program.account.pool.fetch(pool);
    const sa = toUsdc(p.seniorAssets);
    const ja = toUsdc(p.juniorAssets);
    const ss = toUsdc(p.seniorShares);
    const js = toUsdc(p.juniorShares);
    return {
      authority: p.authority.toBase58(),
      couponBps: p.couponBps,
      seniorAssets: sa,
      juniorAssets: ja,
      seniorShares: ss,
      juniorShares: js,
      seniorSharePrice: ss > 0 ? sa / ss : 1,
      juniorSharePrice: js > 0 ? ja / js : 1,
      tvl: sa + ja,
      lastSettleTs: p.lastSettleTs.toNumber(),
    };
  } catch {
    return null; // pool not initialized on this cluster
  }
}

/** Balance of a user's senior/junior share token (UI units), 0 if no ATA. */
export async function shareBalance(
  connection: Connection,
  user: PublicKey,
  tranche: number,
): Promise<number> {
  if (!isConfigured()) return 0;
  const { seniorMint, juniorMint } = derivePdas(new PublicKey(VAULT_AUTHORITY));
  const mint = tranche === SENIOR ? seniorMint : juniorMint;
  const ata = getAssociatedTokenAddressSync(mint, user);
  try {
    const acc = await getAccount(connection, ata);
    return Number(acc.amount) / 10 ** USDC_DECIMALS;
  } catch {
    return 0;
  }
}

export async function buildDepositTx(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  tranche: number,
  amountUi: number,
): Promise<Transaction> {
  const authority = new PublicKey(VAULT_AUTHORITY);
  const usdcMint = new PublicKey(VAULT_USDC_MINT);
  const { pool, vault, seniorMint, juniorMint } = derivePdas(authority);
  const trancheMint = tranche === SENIOR ? seniorMint : juniorMint;
  const user = wallet.publicKey;
  const program = getProgram(connection, wallet);

  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const userShares = getAssociatedTokenAddressSync(trancheMint, user);

  const tx = new Transaction();
  // Create the share ATA if the user doesn't have one yet.
  try {
    await getAccount(connection, userShares);
  } catch {
    tx.add(createAssociatedTokenAccountInstruction(user, userShares, user, trancheMint));
  }

  const amount = new BN(Math.round(amountUi * 10 ** USDC_DECIMALS));
  const depositIx = await program.methods
    .deposit(tranche, amount)
    .accountsPartial({ user, pool, vault, trancheMint, userUsdc, userShares, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  tx.add(depositIx);
  return tx;
}

export async function buildWithdrawTx(
  connection: Connection,
  wallet: { publicKey: PublicKey },
  tranche: number,
  sharesUi: number,
): Promise<Transaction> {
  const authority = new PublicKey(VAULT_AUTHORITY);
  const usdcMint = new PublicKey(VAULT_USDC_MINT);
  const { pool, vault, seniorMint, juniorMint } = derivePdas(authority);
  const trancheMint = tranche === SENIOR ? seniorMint : juniorMint;
  const user = wallet.publicKey;
  const program = getProgram(connection, wallet);

  const userUsdc = getAssociatedTokenAddressSync(usdcMint, user);
  const userShares = getAssociatedTokenAddressSync(trancheMint, user);
  const shares = new BN(Math.round(sharesUi * 10 ** USDC_DECIMALS));

  const ix = await program.methods
    .withdraw(tranche, shares)
    .accountsPartial({ user, pool, vault, trancheMint, userUsdc, userShares, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  return new Transaction().add(ix);
}

// (re-exported to keep imports tidy in the page)
export type { Signer };
