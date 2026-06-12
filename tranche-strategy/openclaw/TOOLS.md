# TOOLS.md — available tools & skills

> What this agent may call. Composed skills + CLIs (verified 2026-06-10).

## Composed skills (we do NOT reimplement these)

| Skill / CLI | Role | Verified surface |
|---|---|---|
| `byreal-cli` 0.3.6 | Solana CLMM yield leg | `pools list/info/analyze`, `positions list/analyze/open/increase/decrease/close/claim`. `-o json` → `{success,meta,data}`. `positions open --unsigned-tx --wallet-address` for the agent-token handoff. |
| `byreal-perps-cli` 0.3.7 | Hyperliquid perp hedge leg | `signal detail/scan`, `account init/info`, `order market <side> <size> <coin>`, `position list/leverage/margin/close-market`. No `--dex` (coin symbol routes; SOL=main). No dry-run; `-y` confirms. |
| `agent-token` | Signing + broadcast + Solana→Hyperliquid bridge | ⛔ onboarding dep. Trusted boundary for ALL fund-moving txs. Interface: `adapters/agent-token.ts`. |
| Mantle decision log | On-chain verifiable journal | self-authored `contracts/DecisionLog.sol` (or hackathon-provided). Emit via `adapters/mantle-log.ts`. |
| ERC-8004 Identity Registry | Agent identity NFT | `scripts/mint-identity.ts`, registration JSON `openclaw/agent-registration.json`. |

## Our own scripts (the deliverable)

`scripts/{init,compute-delta,size-hedge,rebalance,accounting,log-decision}.ts` —
each runnable, each `-o json`. Pure math in `lib/` (network-free, 57 unit tests).

## Parsing contract

All Byreal `-o json` is wrapped `{success,meta,data}` with numeric fields as strings
(some `%`/`$`/`K/M/B` suffixed). Always go through `adapters/byreal-json.ts`
(`unwrap`/`parseNum`/`parsePct`). Never `Number()` a raw CLI field.
