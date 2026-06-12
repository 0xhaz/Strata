# h / c curve reference

The two control parameters, set dynamically from the user's senior/junior capital
split. BarnBridge `SeniorRateModelV3` shape (caps + piecewise-from-ratio); conceptual
reference only, original TS implementation in `lib/hc-curve.ts`. Verified against
`sim/hc_curve.py` in `test/hc-curve.test.ts`.

| jShare (junior %) | h (hedge ratio) | c (coupon) | protection |
|---|---|---|---|
| 5%  | 0.50 | 2.5% | 4%  |
| 10% | 0.57 | 2.6% | 8%  |
| 20% | 0.71 | 2.8% | 16% |
| 30% | 0.86 | 2.9% | 24% |
| 40% | 1.00 | 2.9% | 32% |
| 50%+| 1.00 | 3.0% | 35% (capped) |

**Caps (the BarnBridge guardrail — "never promise more than delivered"):**
`h ≤ 1.0`, `c ≤ 12%` absolute, `c ≥ 2%` floor (else don't offer), protection
`≤ 80%` relative / `≤ 35%` absolute. Piecewise knee at 5% junior dominance; `h`
ramps to 1.0 by 40% junior.

**Coupon economics (conservative, starting values):** `gross = LP_FEE_APR(6%) −
HEDGE_COST_APR(3%)·h`, scaled by protection confidence. Funding carry, when positive,
is UPSIDE on top of `c` — never baseline (design D-04). The coupon barely moves
(2.5%→3.0%): the value is novelty + verifiability + the junior side, not the yield.

These are STARTING values — slopes want tuning on real fee/IL/funding data. The SHAPE
(caps, dynamic-from-ratio) is the sound, BarnBridge-derived skeleton.
