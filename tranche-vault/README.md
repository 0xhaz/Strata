# tranche-vault

> A **pooled** senior/junior risk-tranching vault on Solana — the on-chain layer that
> lets many depositors share one tranche pool (the BarnBridge-style model, single-user
> capital constraint relaxed by the operator's explicit choice).

Original Anchor/Rust. The senior-coupon / junior-first-loss *mechanism* is conceptually
inspired by BarnBridge SmartAlpha; **no BarnBridge Solidity is lifted** — this is a fresh
share-price vault with SPL tranche tokens and a different settlement design.

## How it works

- Users deposit USDC into the **senior** (fixed-ish coupon, first-protected) or **junior**
  (levered residual, first-loss) tranche and receive SPL **share tokens** at the current
  share price.
- The agent operator (`authority`) runs the delta-neutral CLMM+perp strategy **off-chain**
  and reports each period's realized PnL via `settle`. On-chain, the vault applies the
  senior coupon and the junior buffer flow.
- `withdraw` redeems shares for USDC at the current NAV.
- **Solvency invariant:** vault USDC balance == `senior_assets + junior_assets` always.
  The coupon is an internal senior↼junior reallocation (net zero); only realized PnL moves
  USDC in/out during `settle`.

Instructions: `initialize_pool(coupon_bps)` · `deposit(tranche, amount)` ·
`settle(realized_pnl)` (authority-only) · `withdraw(tranche, shares)` ·
`set_paused(bool)` (authority-only circuit breaker — pauses deposits + settle; withdrawals
stay open so depositors can always exit). Caps: coupon ≤ 12%.
Program: `programs/tranche-vault/src/lib.rs`.

**Loss handling:** junior is first-loss — `settle` of a negative PnL hits junior first; if it
wipes the junior buffer, senior absorbs the remainder (and can lose principal), always
preserving the solvency invariant. Defensive guards: non-authority settle rejected, paused
deposits rejected, over-withdraw rejected, redemption never exceeds the vault balance.

## Agent → vault bridge

The off-chain agent (`../tranche-strategy`) computes the period's realized PnL and reports it:

```bash
node_modules/.bin/ts-node app/agent-settle.ts --pnl 150         # report +$150 on-chain
node_modules/.bin/ts-node app/agent-settle.ts --pnl -80 --dry-run    # build unsigned for agent-token
node_modules/.bin/ts-node app/agent-settle.ts --accrue --fee-apr 0.06  # book fees since last settle
```

`--accrue` is stateless (reads the pool's on-chain `last_settle_ts`), so a scheduled
settle is just a cron tick — consistent with OpenClaw's native loop (we don't build a
scheduler):

```cron
# hourly: book accrued strategy yield into the pool NAV (testnet)
0 * * * * cd ~/tranche-vault && ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
  ANCHOR_WALLET=~/.config/solana/id.json node_modules/.bin/ts-node app/agent-settle.ts --accrue
```

## Test-USDC faucet + a real third-party deposit

```bash
node_modules/.bin/ts-node app/faucet-usdc.ts --to <any-pubkey> --amount 1000   # hand out test-USDC
node_modules/.bin/ts-node app/demo-third-party.ts                              # fresh wallet deposits on-chain
```

## Build & test

```bash
anchor build
anchor test          # 9 on-chain tests: init, deposits, settle, withdraw-at-NAV,
                     # non-authority settle rejected, pause, over-withdraw rejected,
                     # buffer breach (junior wiped + senior absorbs), post-breach redeem,
                     # orphan-safe (gain with no junior holders routes to senior)
```

> Note: the bundled SBF toolchain is rustc 1.84; `Cargo.lock` pins a few crates
> (proc-macro-crate, blake3, indexmap, unicode-segmentation) to their last pre-`edition2024`
> versions so it compiles. If the toolchain is upgraded (rustc ≥ 1.85), those pins can be
> dropped.
>
> If port 8000 is busy, `Anchor.toml` already moves the validator's gossip/dynamic ports.

## Run the live demo (localnet)

```bash
# 1) validator with the program preloaded
solana-test-validator --reset --bpf-program <PROGRAM_ID> target/deploy/tranche_vault.so \
  --gossip-port 8020 --dynamic-port-range 8020-8060

# 2) create test-USDC, init a pool, seed deposits + a settle, print the web env
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=~/.config/solana/id.json \
  node_modules/.bin/ts-node app/init-pool.ts

# 3) paste the printed NEXT_PUBLIC_* into web/.env.local, then `cd ../web && pnpm build && pnpm start`
#    → http://localhost:3000/vault  (deposit / redeem against the live program)
```

Devnet deploy is the same `solana program deploy` (needs ~2.4 SOL for rent); set the web
`NEXT_PUBLIC_SOLANA_RPC` to devnet and re-init.

## Relationship to the rest of the project

This is the **pooled** layer. The off-chain agent (`../tranche-strategy`) computes the
sizing/hedge/accounting and would call `settle`; the operator app (`../web`) is the
front-end. The vault is honest about the boundary: it holds USDC + does the tranche
accounting; live strategy execution (LP + perp hedge) remains the agent's off-chain job.
