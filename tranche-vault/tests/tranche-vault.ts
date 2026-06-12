import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { TrancheVault } from "../target/types/tranche_vault";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

const SENIOR = 0;
const JUNIOR = 1;
const USDC = (n: number) => new BN(n).mul(new BN(1_000_000)); // 6 decimals

describe("tranche-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.trancheVault as Program<TrancheVault>;
  const authority = provider.wallet as anchor.Wallet;
  const conn = provider.connection;

  let usdcMint: PublicKey;
  let pool: PublicKey, vault: PublicKey, seniorMint: PublicKey, juniorMint: PublicKey;
  let authUsdc: PublicKey;
  const userA = Keypair.generate(); // senior depositor
  const userB = Keypair.generate(); // junior depositor

  const pda = (seed: string, extra: Buffer) =>
    PublicKey.findProgramAddressSync([Buffer.from(seed), extra], program.programId)[0];
  const tp = anchor.utils.token.TOKEN_PROGRAM_ID;
  const vaultBal = async () => new BN((await getAccount(conn, vault)).amount.toString());
  const solvent = async () => {
    const p = await program.account.pool.fetch(pool);
    assert.equal((await vaultBal()).toString(), p.seniorAssets.add(p.juniorAssets).toString(), "solvency");
  };

  before(async () => {
    for (const u of [userA, userB]) {
      await conn.confirmTransaction(await conn.requestAirdrop(u.publicKey, 2 * LAMPORTS_PER_SOL));
    }
    usdcMint = await createMint(conn, authority.payer, authority.publicKey, null, 6);
    pool = pda("pool", authority.publicKey.toBuffer());
    vault = pda("vault", pool.toBuffer());
    seniorMint = pda("senior", pool.toBuffer());
    juniorMint = pda("junior", pool.toBuffer());
  });

  async function fundUsdc(user: Keypair, amount: BN) {
    const ata = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, usdcMint, user.publicKey)).address;
    await mintTo(conn, authority.payer, usdcMint, ata, authority.publicKey, BigInt(amount.toString()));
    return ata;
  }
  async function atas(user: Keypair, trancheMint: PublicKey) {
    const usdc = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, usdcMint, user.publicKey)).address;
    const shares = (await getOrCreateAssociatedTokenAccount(conn, authority.payer, trancheMint, user.publicKey)).address;
    return { usdc, shares };
  }

  it("initializes the pool (2.87% coupon, unpaused)", async () => {
    await program.methods
      .initializePool(287)
      .accountsPartial({ authority: authority.publicKey, usdcMint, pool, vault, seniorMint, juniorMint, tokenProgram: tp, systemProgram: SystemProgram.programId, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .rpc();
    const p = await program.account.pool.fetch(pool);
    assert.equal(p.couponBps, 287);
    assert.equal(p.paused, false);
    authUsdc = await fundUsdc(authority.payer, USDC(5000));
  });

  it("senior 6000 + junior 4000 deposits, 1:1 bootstrap shares, solvent", async () => {
    await fundUsdc(userA, USDC(6100)); // 6000 + 100 for the later pause test
    await fundUsdc(userB, USDC(4000));

    const a = await atas(userA, seniorMint);
    await program.methods.deposit(SENIOR, USDC(6000))
      .accountsPartial({ user: userA.publicKey, pool, vault, trancheMint: seniorMint, userUsdc: a.usdc, userShares: a.shares, tokenProgram: tp })
      .signers([userA]).rpc();

    const b = await atas(userB, juniorMint);
    await program.methods.deposit(JUNIOR, USDC(4000))
      .accountsPartial({ user: userB.publicKey, pool, vault, trancheMint: juniorMint, userUsdc: b.usdc, userShares: b.shares, tokenProgram: tp })
      .signers([userB]).rpc();

    const p = await program.account.pool.fetch(pool);
    assert.equal(p.seniorAssets.toString(), USDC(6000).toString());
    assert.equal(p.juniorAssets.toString(), USDC(4000).toString());
    assert.equal(p.seniorShares.toString(), USDC(6000).toString());
    await solvent();
  });

  it("settle(+200): junior takes the residual, solvent", async () => {
    const before = await program.account.pool.fetch(pool);
    await program.methods.settle(new BN(USDC(200).toString()))
      .accountsPartial({ authority: authority.publicKey, pool, vault, authorityUsdc: authUsdc, tokenProgram: tp })
      .rpc();
    const after = await program.account.pool.fetch(pool);
    const gain = after.juniorAssets.sub(before.juniorAssets);
    assert.isTrue(gain.lte(USDC(200)) && gain.gt(USDC(199)), `junior gain ${gain}`);
    assert.isTrue(after.seniorAssets.gte(before.seniorAssets));
    await solvent();
  });

  it("rejects settle from a non-authority", async () => {
    let threw = false;
    try {
      await program.methods.settle(new BN(USDC(100).toString()))
        .accountsPartial({ authority: userA.publicKey, pool, vault, authorityUsdc: authUsdc, tokenProgram: tp })
        .signers([userA]).rpc();
    } catch { threw = true; }
    assert.isTrue(threw, "non-authority settle must fail");
  });

  it("rejects withdraw beyond shares", async () => {
    const a = await atas(userA, seniorMint);
    let threw = false;
    try {
      await program.methods.withdraw(SENIOR, USDC(7000))
        .accountsPartial({ user: userA.publicKey, pool, vault, trancheMint: seniorMint, userUsdc: a.usdc, userShares: a.shares, tokenProgram: tp })
        .signers([userA]).rpc();
    } catch { threw = true; }
    assert.isTrue(threw, "over-withdraw must fail");
  });

  it("pause blocks deposits but unpause restores them", async () => {
    await program.methods.setPaused(true).accounts({ authority: authority.publicKey, pool }).rpc();
    assert.equal((await program.account.pool.fetch(pool)).paused, true);

    const a = await atas(userA, seniorMint);
    let threw = false;
    try {
      await program.methods.deposit(SENIOR, USDC(100))
        .accountsPartial({ user: userA.publicKey, pool, vault, trancheMint: seniorMint, userUsdc: a.usdc, userShares: a.shares, tokenProgram: tp })
        .signers([userA]).rpc();
    } catch { threw = true; }
    assert.isTrue(threw, "deposit while paused must fail");

    await program.methods.setPaused(false).accounts({ authority: authority.publicKey, pool }).rpc();
    await program.methods.deposit(SENIOR, USDC(100))
      .accountsPartial({ user: userA.publicKey, pool, vault, trancheMint: seniorMint, userUsdc: a.usdc, userShares: a.shares, tokenProgram: tp })
      .signers([userA]).rpc();
    await solvent();
  });

  it("buffer breach: a loss exceeding junior wipes it and senior absorbs the remainder", async () => {
    const before = await program.account.pool.fetch(pool); // junior ≈ 4200, senior ≈ 6100
    const loss = before.juniorAssets.add(USDC(100)); // exceed junior by 100
    await program.methods.settle(new BN(loss.neg().toString()))
      .accountsPartial({ authority: authority.publicKey, pool, vault, authorityUsdc: authUsdc, tokenProgram: tp })
      .rpc();
    const after = await program.account.pool.fetch(pool);
    assert.equal(after.juniorAssets.toNumber(), 0, "junior wiped");
    // senior absorbed the 100 over-loss (and ~0 coupon).
    const seniorDrop = before.seniorAssets.sub(after.seniorAssets);
    assert.isTrue(seniorDrop.gte(USDC(99)) && seniorDrop.lte(USDC(101)), `senior drop ${seniorDrop}`);
    await solvent(); // invariant survives the breach
  });

  it("post-breach: junior shares redeem near zero (junior took the loss)", async () => {
    const b = await atas(userB, juniorMint);
    const p = await program.account.pool.fetch(pool);
    const usdcBefore = new BN((await getAccount(conn, b.usdc)).amount.toString());
    await program.methods.withdraw(JUNIOR, p.juniorShares)
      .accountsPartial({ user: userB.publicKey, pool, vault, trancheMint: juniorMint, userUsdc: b.usdc, userShares: b.shares, tokenProgram: tp })
      .signers([userB]).rpc();
    const got = new BN((await getAccount(conn, b.usdc)).amount.toString()).sub(usdcBefore);
    assert.isTrue(got.lte(USDC(1)), `junior redeemed ~0, got ${got}`);
    await solvent();
  });

  it("orphan-safe: with no junior holders, a settle gain routes to senior (not stranded)", async () => {
    const before = await program.account.pool.fetch(pool);
    assert.equal(before.juniorShares.toNumber(), 0, "precondition: no junior shares");
    await program.methods.settle(new BN(USDC(100).toString()))
      .accountsPartial({ authority: authority.publicKey, pool, vault, authorityUsdc: authUsdc, tokenProgram: tp })
      .rpc();
    const after = await program.account.pool.fetch(pool);
    assert.equal(after.juniorAssets.toNumber(), 0, "no junior holders → nothing stranded in junior");
    const seniorGain = after.seniorAssets.sub(before.seniorAssets);
    assert.isTrue(seniorGain.gte(USDC(99)) && seniorGain.lte(USDC(101)), `senior received the gain (${seniorGain})`);
    await solvent();
  });
});
