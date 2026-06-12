# USER.md — operator profile & allocation

> Working state the agent maintains about its single operator. Mutated by the skill
> after material actions (RealClaw pattern). Authoritative numeric state lives in
> `config/state.json`; this file is the human-readable mirror.

## Operator

- **Capital:** single-user, own funds only. Never pooled. (AGENTS.md §1.)
- **Network:** testnet.
- **Wallet:** Solana Privy wallet (custody + USDC). Address injected at setup; the
  agent reads it but never holds the key.

## Allocation (example — set via `scripts/init.ts`)

| Sleeve | Amount | Share | Gets |
|---|---|---|---|
| Senior | $6,000 | 60% | fixed-ish coupon `c`, delta-neutralized |
| Junior | $4,000 | 40% | levered residual: net PnL + IL + funding − senior coupon |

Derived params at this split (hc-curve): `h = 1.00`, `c = 2.87%`, protection = 32%,
`T = 6%`. Re-derived whenever the operator changes the split.

## Standing instructions

- Hold the senior delta-neutral through SOL swings; rebalance only past threshold T.
- Treat funding carry as upside, never as baseline coupon.
- Notify on: rebalance executed, range exit, re-range, buffer breach, stale-skip streak.
- Be honest in any report: delta-hedged, not riskless; coupon is modest by design.
