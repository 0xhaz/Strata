# tranche-strategy

> An autonomous agent that turns a single volatile CLMM LP into a two-sided risk
> product — a delta-neutral fixed-coupon **senior** sleeve and a levered-residual
> **junior** sleeve — by actively managing a cross-venue Hyperliquid perp hedge,
> with the whole risk transformation verifiable on-chain.

The only original code in the submission. It composes Byreal CLMM (Solana yield),
Byreal Perps (Hyperliquid hedge), and the agent-token signing/bridge skill; the
novel part is the senior/junior invariant, funding-aware hedge sizing, accounting,
and on-chain decision logging. See [`SKILL.md`](./SKILL.md) for the mechanism.

## Layout

```
lib/        pure math (network-free, unit-tested):
              clmm-delta · hc-curve · size-hedge · rebalance · accounting
adapters/   I/O layer: byreal-clmm, byreal-perps (shell out, -o json),
              agent-token + mantle-log (blocked onboarding deps — honest stubs)
scripts/    single-purpose CLIs: init · compute-delta · size-hedge · rebalance ·
              accounting · log-decision  (each supports -o json)
state/      atomic JSON state store (temp-then-rename) + schema
sim/        replay harness: synthetic SOL swing → real loop → decision-log artifact
test/       47 unit tests pinned to the design-doc tables + Python sims
config/     params.json; state.json / replay.json / decision-log.jsonl (generated)
```

## Quick start

```bash
pnpm install
pnpm test                 # 47 unit tests (math vs design-doc + sim fixtures)
pnpm typecheck

# Initialize state from a capital split (single-user capital, testnet)
pnpm exec tsx scripts/init.ts --senior 6000 --junior 4000 --entry 150

# Autonomous loop (live): wakes on a schedule, reads BOTH Byreal skills live, decides + logs
pnpm agent-loop --ticks 8 --interval 15   # opens the hedge, then holds delta-neutral

# Demo: drive a synthetic SOL swing through the real loop → config/replay.json
pnpm replay               # seed 3: SOL 137→175, holds delta-neutral, 0 range-exits

# Inspect a single decision (offline, no CLIs needed)
pnpm exec tsx scripts/size-hedge.ts --delta 30.9 --senior-share 0.6 --h 1 --price 138 --funding 0.08 -o json
```

## What's live vs. blocked

| Component | Status |
|---|---|
| Pure math + 59 tests | ✅ done, verified |
| State store, scripts, replay demo | ✅ done, runnable today |
| Byreal CLI adapters | ✅ **verified live** against byreal-cli 0.3.6 / byreal-perps-cli 0.3.7 — real `{success,meta,data}` shapes, `%`/`$` parsing, real SOL/USDC pool & funding read (techstacks §5.1) |
| Two-venue partial-failure safety | ✅ **proven live** — a failed perps read correctly yielded `skip-stale` (held, didn't act on stale data) |
| OpenClaw workspace config | ✅ done — `openclaw/` (AGENTS/SOUL/TOOLS/USER/IDENTITY + wake-loop) |
| Mantle DecisionLog | ✅ self-authored `contracts/DecisionLog.sol` + `buildLogTx` (unsigned, unit-tested); journals locally until address+signer wired |
| ERC-8004 identity mint | ✅ `scripts/mint-identity.ts` builds the unsigned `register()` calldata; needs Mantle registry address to broadcast |
| `agent-token` signing/bridge | ⛔ onboarding dep — interface only, never fakes a signature |
| Mantle log contract address + signer | ⛔ onboarding dep — `writeOnChain` anchors once `MANTLE_DECISION_LOG`/chain/signer are set |

> **Delta proxy note (Phase-0 gate):** the CLI exposes `liquidityUsd` + range, not a
> direct SOL token amount — so delta is DERIVED (closed form). See techstacks §5.1.

The dashboard in [`../web`](../web) visualizes the replay artifact + decision log.

## Honesty

Senior is **delta-hedged, not riskless** — a linear perp can't fully neutralize
IL/gamma; in a gap or range-exit the senior eats tracking error. The sim's magnitudes
are not trustworthy (under-models gap risk). We pitch novelty + verifiability + the
junior's levered exposure, not a market-beating coupon.
