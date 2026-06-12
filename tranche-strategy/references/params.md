# Parameters reference

Live values in `config/params.json`. Source: `tranche-design.md` §9/§10.

| Param | Value | Source / rationale |
|---|---|---|
| Rebalance threshold `T` | **6%** (range 5–8%) | sim §9 knee; over-rebalancing bleeds gas/funding |
| Hedge ratio `h` | dynamic 0.5→1.0 | by junior share (hc-curve.md) |
| Coupon `c` | dynamic 2.5%→3.0%, cap 12% | hc-curve.md |
| Protection cap | 35% absolute / 80% relative | BarnBridge-derived |
| Delta proxy | SOL token amount in LP position | recomputed each cycle (design §3) |
| Range width | ±15% around entry | mirrors sim band [0.85, 1.15]·P0 |
| LP fee APR (assumed) | 6% | mid of 3–8% for SOL/USDC CLMM |
| Hedge cost APR (assumed) | 3% | sim §9 net cost at T≈8% |
| Coin / DEX | SOL / `main` | always specify DEX — bare tickers silent-route |

**Tuning status:** SHAPE is sound (caps, knee location, dynamic-from-ratio). MAGNITUDES
are not trustworthy — the sim under-models gap/range-exit risk and over-trusts funding
(design §9). Re-run on real SOL/USDC ticks before any quantitative safety claim.

## Rebalance threshold sweep (sim §9, synthetic — shape transfers, magnitudes don't)

| T | rebal/mo | net cost (% senior) | tracking err (% RMS) |
|---|---|---|---|
| 0.5% | ~14,000 | 37.5% | 0.41% |
| 2% | ~4,400 | 11.9% | 0.63% |
| 5% | ~1,700 | 4.6% | 1.44% |
| **8%** | **~1,000** | **2.75%** | **2.12%** |
| 12% | ~700 | 1.75% | 3.97% |
| 20% | ~420 | 0.92% | 6.20% |

Balanced-weight optimum ≈ T = 8%. Start the build at T ≈ 5–8%.
