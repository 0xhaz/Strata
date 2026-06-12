# mantle-vault — Strata's on-chain settlement layer

The Solidity contracts that make Strata a **real product on Mantle**, not just an off-chain bot.
This is where RWAs are deposited, split into senior/junior tranche tokens, and where the AI
agent's realized yield is settled — every balance and every settlement lives here, on-chain.

> Mantle is the **settlement layer**. The strategy executes off-chain (see `../tranche-strategy`);
> this repo holds the funds, issues the tranche tokens, enforces compliance, and applies yield.

---

## The contracts

| Contract | What it is | Role |
|---|---|---|
| **`TrancheVault.sol`** | The core vault. Holds the RWA, mints/burns tranche tokens, applies the senior coupon + junior buffer on each settle. | The product |
| **`TrancheToken.sol`** | A minimal ERC-20 (`trSR` senior, `trJR` junior). Mint/burn restricted to its vault. | Tranche ownership |
| **`TestRWA.sol`** | Mock yield-bearing RWA (stands in for mETH / USDY) with an **open `mint()` faucet** for testnet. | The deposit asset |
| **`DecisionLog.sol`** | Permissionless event emitter. The agent appends one `Decision` event per wake-cycle. | On-chain audit trail |

Each vault deployment is a set of five contracts: one `TrancheVault`, its two `TrancheToken`s
(created in the vault's constructor), one `TestRWA` asset, and one `DecisionLog`. Strata runs two:
**mETH** and **USDY**.

---

## How `TrancheVault` works

### Tranches & share price (NAV)
Two tranches, identified by index: **`SENIOR = 0`**, **`JUNIOR = 1`**. Each is an independent ERC-20.

The vault tracks the **asset value** claimable by each tranche in `seniorAssets` / `juniorAssets`.
A tranche's **NAV per share** is just `assets / shares`:

```
sharePrice(tranche) = (trancheAssets * 1e18) / trancheToken.totalSupply()
```

NAV starts at `1.0` and **rises as the agent reports yield** — that's how a depositor's position
grows without their share count changing.

### Deposit  → `deposit(tranche, amount)`
Pulls `amount` of the RWA from the user and mints tranche tokens at the current NAV:
```
minted = amount * totalShares / trancheAssets    // (1:1 on the first deposit)
```
Because NAV is usually > 1, you get **fewer shares than tokens deposited** — that's correct, and
the share is worth proportionally more. **KYC-gated** (see compliance below).

### Withdraw / redeem  → `withdraw(tranche, shares)`
Burns `shares` and returns the RWA at the current NAV:
```
amountOut = shares * trancheAssets / totalShares
```
**Always open** — never pausable — so holders can always exit. (The frontend's "Redeem" calls this;
note the argument is **shares**, not asset amount.)

### Settle  → `settle(int256 realizedPnl)`  *(the heart of it)*
Called by the agent each period with the realized strategy PnL. It:
1. Computes the **senior coupon** accrued over the elapsed time (`couponBps`, time-weighted).
2. Moves the PnL as **real RWA** — pulled in from the settler if positive, paid out if negative —
   so the **solvency invariant** `asset.balanceOf(vault) == seniorAssets + juniorAssets` always holds.
3. Applies it **junior-first**:
   - **Normal:** senior gets its coupon, junior takes the residual (gain *or* loss). Junior NAV moves.
   - **Buffer breach:** if the loss exceeds the junior buffer, junior is wiped to zero and **senior
     absorbs only the remainder** — senior is protected first (`breach-safe`).
   - **Orphan-safe:** a tranche only accrues residual if it actually has holders.

This is the senior/junior structured-credit mechanism, enforced on-chain. See it live with
`../tranche-strategy/scripts/breach-demo.ts`.

---

## Trust-minimization

Because the vault settles an off-chain AI's numbers, it **bounds what that agent can do**:

- **Bounded settle** — a single `settle()` can move at most **`maxSettleBps` (20%)** of TVL. A
  compromised key can't drain the vault in one tx, and the AI's reported PnL is self-policed.
- **Role split** — the hot **`settler`** key only reports PnL (within the band); a separate cold
  **`owner`** holds pause / KYC / role rotation. Rotate with `setSettler`.
- **KYC gate** — deposits require `kycApproved[user]` (RWA compliance); set by the owner via
  `setKyc` / `setKycBatch`. Withdrawals are never gated.
- **Pausable deposits/settles** — `setPaused(true)` halts inflows; withdrawals stay open.

*Roadmap: multisig + timelock owner, proof-of-reserves oracle, continuous accrual.*

---

## Contract interface (who calls what)

```solidity
// ── User (frontend / MetaMask) ──
function deposit(uint8 tranche, uint256 amount) external;   // KYC-gated
function withdraw(uint8 tranche, uint256 shares) external;  // always open

// ── Agent (settler key) ──
function settle(int256 realizedPnl) external;               // onlySettler, |pnl| ≤ maxSettleBps·TVL

// ── Admin (owner key) ──
function setKyc(address user, bool approved) external;
function setKycBatch(address[] calldata users, bool approved) external;
function setPaused(bool p) external;
function setSettler(address settler_) external;
function setMaxSettleBps(uint16 bps) external;

// ── Views (frontend reads these every few seconds) ──
function tvl() external view returns (uint256);
function sharePrice(uint8 tranche) external view returns (uint256);  // NAV, 1e18
function seniorAssets() / juniorAssets() / couponBps() / paused() / kycApproved(address) view;
```

---

## How the frontend uses these contracts

The web app ([`../web`](../web)) talks to the vault **directly over RPC** — no indexer, no backend
DB. Everything on the `/mantle` page is a live contract read or a MetaMask-signed write.

| Frontend action | Contract call | Where |
|---|---|---|
| Vault cards (TVL, coupon, NAV, senior/junior split) | `tvl`, `couponBps`, `sharePrice(0/1)`, `seniorAssets`, `juniorAssets` | `web/src/lib/mantle.ts` → `readVault()` |
| "Your position" (balances, KYC, shares) | `asset.balanceOf`, `trancheToken.balanceOf`, `kycApproved`, `asset.allowance` | `mantle.ts` → `readUser()` |
| **Faucet** button | `TestRWA.mint(you, 10e18)` | `web/src/components/mantle-vault.tsx` |
| **Approve** → **Deposit** | `asset.approve` → `vault.deposit(tranche, amount)` | same |
| **Redeem** (with the MAX helper) | `vault.withdraw(tranche, shares)` | same |
| **Get approved (KYC)** | `vault.setKyc(you, true)` — signed **server-side** by the owner key | `web/src/app/api/mantle/kyc/route.ts` |

The contract addresses + per-vault metadata the frontend reads from
[`deployments/mantle-sepolia.json`](deployments/mantle-sepolia.json) (the web vendors a copy at
`web/src/data/mantle-deployment.json`). **To point the frontend at a new deployment, update those
two JSON files** — nothing else changes.

## How the agent uses these contracts

The off-chain agent ([`../tranche-strategy`](../tranche-strategy)) is the **settler**: each period it
calls `settle(realizedPnl)` (lifting junior NAV, which the frontend then shows), and appends a
`DecisionLog.logDecision(...)` event per cycle for the verifiable audit trail.

---

## Deployed (Mantle Sepolia · chainId 5003 · all verified)

| | mETH vault | USDY vault |
|---|---|---|
| **TrancheVault** | `0x7dF879Ff39AC3bAC696A38Da05aa19b51f9D1818` | `0x5BD8C01c04fbceB769B82b13d6A879a1081f75d1` |
| asset (RWA) | `0x83130374d16D5d1d95dB1ABE38cebF3F61c88329` | `0x9d3824f42dFF56D530Bfedd849c21CCc5b7128f5` |
| seniorToken `trSR` | `0xeDA923bA147e6CDE088399De10B2152AeB51e2c2` | `0xeDdAC58af69925A8C78c1b7C75568b3b6C7153a6` |
| juniorToken `trJR` | `0x42935Cd68ceCff9cC6De318C3E303464B808648E` | `0xea25aC784F269b63791840ff61Cb66Eb554D3b97` |
| DecisionLog | `0x0f64Cb12512667BBcFDE913048fA68051e632abE` | `0xE71600e749bB899E7768ddfc962B70663dF3c9E0` |
| coupon · cap | 2.87% · 20% | 4.50% · 20% |

Source + ABI public on [Mantlescan](https://sepolia.mantlescan.xyz/address/0x7dF879Ff39AC3bAC696A38Da05aa19b51f9D1818#code).

---

## Develop

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts   # restore deps
forge build
forge test            # 11 tests — deposit, settle, breach-safe, orphan-safe, cap, role split

# Deploy (testnet). PRIVATE_KEY in .env (gitignored). mETH is the default; USDY via env overrides.
forge script script/Deploy.s.sol:Deploy --rpc-url mantle_sepolia --broadcast

# Verify every contract on Mantlescan (needs ETHERSCAN_API_KEY)
./verify.sh
```

After redeploying, update `deployments/mantle-sepolia.json` **and** `web/src/data/mantle-deployment.json`
with the new addresses (the deploy script prints them), then re-run `./verify.sh`.
