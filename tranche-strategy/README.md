# tranche-strategy — Strata's AI agent

The **autonomous AI agent** that runs Strata's strategy and reports the results to Mantle. It's a
rules-based control loop (not an LLM guessing trades): every wake cycle it reads live market data,
sizes a delta-neutral hedge, decides hold/rebalance with two-venue safety, and **settles the
period's realized yield on-chain** — which is what lifts the junior NAV your depositors see.

> This is Strata's original code. The contracts ([`../mantle-vault`](../mantle-vault)) are the
> settlement layer; this is the brain that drives them. The strategy *executes* off-chain (Byreal /
> Hyperliquid); the *result* is settled on Mantle.

---

## What the agent does each cycle

```
1. WAKE      (cron-style, every N seconds)
2. READ      live ETH price + funding from Hyperliquid (byreal-perps-cli)
             (CLMM-mode: pool price from byreal-cli)
3. COMPUTE   the mETH delta and the senior-hedge target (pure math, lib/)
4. DECIDE    hold / rebalance / re-range / skip-stale  (+ rationale)
5. SETTLE    report net yield to the Mantle vault ON-CHAIN  → junior NAV ↑
6. JOURNAL   append the decision (local + unsigned DecisionLog tx) and publish the live feed
```

The strategy is **delta-neutral staked-ETH yield** (the Ethena/USDe playbook on Mantle's LST): hold
mETH for its staking yield, short the ETH perp to cancel the price risk. Net yield = staking APR **+
the live funding the agent just read**. The USDY vault tranches native treasury yield (no hedge).
The agent is asset-agnostic — pass `--pair SOL/USDC` for the CLMM/gamma mode used in the lab.

---

## The on-chain handoff (the verifiable part)

Two things cross from off-chain agent to on-chain Mantle:

### 1. Yield settlement — **live**, real transactions
Each `--settle` cycle the agent signs and broadcasts `TrancheVault.settle(realizedPnl)` via
[`adapters/mantle-vault.ts`](adapters/mantle-vault.ts):
- `settleAccrued(key, yieldApr)` — settles the yield accrued since the vault's on-chain
  `lastSettleTs` (used by the loop).
- `settleExact(key, pnlBase)` — settles an explicit amount (used by `mantle-settle` / `breach-demo`).
- Signs as the **settler** key, so it's bounded by the vault's `maxSettleBps` cap — the agent can't
  move more than 20% of TVL per settle. The PnL is backed by real RWA (solvency preserved).

This is what makes the AI's output **auditable**: not a UI number, a Mantle tx hash. Each settle
nudges junior NAV up, which `../web` reads back live.

### 2. Decision log — deployed, journaled + unsigned-tx-ready
Every decision is appended to an append-only local journal, and the matching **unsigned**
`DecisionLog.logDecision(...)` tx is built ([`adapters/mantle-log.ts`](adapters/mantle-log.ts)). The
`DecisionLog` contract is deployed on Mantle; on-chain anchoring activates when `MANTLE_DECISION_LOG`
+ the agent-token signer are set. We never fabricate a tx hash — the journal is honest about which
records are anchored. *(CLAUDE.md rule 1: every fund-moving tx is built unsigned, then handed to the
agent-token skill for signing — never reimplement key handling.)*

---

## Key scripts

| Script | What it does |
|---|---|
| **`scripts/agent-loop.ts`** | The autonomous loop. `--ticks 0` runs forever; `--settle` reports yield on-chain every `--settle-every` cycles. Publishes `config/live.json` (the `/live` feed). |
| **`scripts/mantle-settle.ts`** | CLI to settle one/all vaults: `--accrue` (time-accrued) or `--pnl <x>` (explicit). `--dry-run` emits the unsigned tx for the agent-token handoff. |
| **`scripts/breach-demo.ts`** | Reports a sequence of **negative** settles to show junior absorbing a loss while senior NAV holds — the tranche structure's whole point, on-chain. `--breach` pushes past the buffer; default self-recovers. |
| `scripts/size-hedge.ts`, `compute-delta.ts`, `rebalance.ts`, `accounting.ts` | Single-purpose CLIs over the pure math (offline, `-o json`). |

---

## Layout

```
lib/        pure math (network-free, 59 unit tests):
              clmm-delta · hc-curve · size-hedge · rebalance · accounting
adapters/   I/O layer:
              mantle-vault.ts  → reads vault state + signs/broadcasts settle()  (LIVE)
              mantle-log.ts    → DecisionLog journal + unsigned on-chain tx
              byreal-perps.ts  → Hyperliquid price + funding (byreal-perps-cli, -o json)
              byreal-clmm.ts   → Solana CLMM pool data (byreal-cli, -o json)
              agent-token.ts   → signing/bridge handoff (interface; never fakes a signature)
scripts/    the CLIs above (each supports -o json)
state/      atomic JSON state store (temp-then-rename) + schema
sim/        replay harness: synthetic price path → real loop → decision-log artifact
config/     params.json; state.json / live.json / decision-log.jsonl (generated, gitignored)
openclaw/   OpenClaw skill config (AGENTS / IDENTITY / wake-loop)
```

The vault addresses are read from [`../mantle-vault/deployments/mantle-sepolia.json`](../mantle-vault/deployments/mantle-sepolia.json)
— the adapter resolves the live mETH/USDY vaults automatically.

---

## How it connects to the frontend

The agent never talks to the web app directly — it goes **through Mantle and one feed file**:

| Agent output | How `../web` consumes it |
|---|---|
| `settle()` txs → junior NAV rises on-chain | `/mantle` reads `sharePrice()` live → the position grows |
| `config/live.json` (published each cycle) | `/live` polls `/api/live` → streams the decision table + hedge chart |

So to demo the full loop: run `agent-loop --settle` here, and watch NAV climb on `/mantle` and the
decisions stream on `/live`.

---

## Quick start

```bash
pnpm install
pnpm test                  # 59 unit tests (math vs design-doc + sim fixtures)
pnpm typecheck

# The full live cycle — read live data → decide → SETTLE on Mantle
pnpm agent-loop --ticks 0 --interval 30 --settle --settle-every 4

# Settle a vault directly (real tx); --dry-run prints the unsigned tx instead
pnpm exec tsx scripts/mantle-settle.ts --vault mETH --pnl 0.02

# Show senior protection under a loss (real negative settles, self-recovers)
pnpm exec tsx scripts/breach-demo.ts --vault mETH

# Offline: inspect one hedge-sizing decision (no network)
pnpm exec tsx scripts/size-hedge.ts --delta 5.95 --senior-share 0.6 --h 1 --price 1680 --funding -0.04 -o json
```

Settling needs the settler key: set `MANTLE_AGENT_KEY`, or it falls back to
`../mantle-vault/.env` `PRIVATE_KEY` (both gitignored).

---

## Honesty

- Senior is **delta-hedged, not riskless** — a linear perp can't fully neutralize gap / range-exit
  risk; in a sudden move senior eats tracking error. That's exactly why the junior buffer exists.
- Funding can be **negative** (a cost), so net yield isn't guaranteed — the agent reads it live and
  reports it honestly rather than assuming carry.
- Settlement is a trusted-but-**bounded**, role-split authority today (see `../mantle-vault`);
  production swaps it for a multisig + proof-of-reserves oracle.
- Testnet, mock RWAs. The read→decide→settle loop is live; hedge *execution* is the agent-token
  signing handoff.
