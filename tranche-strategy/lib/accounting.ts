/**
 * Senior coupon vs realized yield, and the junior-buffer flow.
 *
 * Resolves the [OPEN] formula from tranche-design.md §8 step 4 / workplan §2.4.
 * It is the BarnBridge `minPrice` floor (architecture §8.1) re-expressed for a
 * *coupon* instead of a price: the junior sleeve takes the first losses and keeps
 * the excess, and can never go below zero.
 *
 * ── The model (per wake cycle, over year-fraction Δt) ──────────────────────────
 *   couponOwed     = seniorCap × c × Δt                  (what senior is promised)
 *   seniorRealized = senior-share of LP fees
 *                    + funding earned on the short        (carry; ≤0 if cost)
 *                    − IL borne on senior's share         (the short-gamma leak)
 *
 *   shortfall = max(0, couponOwed − seniorRealized)
 *   excess    = max(0, seniorRealized − couponOwed)
 *
 *   • shortfall: junior buffer covers it (buffer −= shortfall). Senior is paid the
 *     full coupon — UNLESS the buffer is exhausted, in which case senior eats the
 *     uncovered remainder and we raise `bufferBreached` (the honest gap/range-exit
 *     risk the docs refuse to paper over).
 *   • excess: junior keeps it (buffer += excess) — the junior's upside.
 *
 * Funding carry, when positive, flows into seniorRealized as a bonus on top of
 * fees; it is never assumed (design D-04) — the caller passes the *realized* number.
 */
import { Decimal, D } from "./decimal.js";

export interface PeriodEconomics {
  seniorCapUsd: Decimal | number;
  couponAnnual: Decimal | number; // c
  dtYears: Decimal | number; // Δt
  seniorFeesUsd: Decimal | number; // senior-share of LP fees this period
  fundingUsd: Decimal | number; // funding earned (+) or paid (−) on the short
  seniorIlUsd: Decimal | number; // IL borne on senior's share (positive magnitude)
  juniorBufferUsd: Decimal | number; // junior capital available to absorb shortfall
}

export interface PeriodSettlement {
  couponOwedUsd: number;
  seniorRealizedUsd: number;
  shortfallUsd: number;
  excessUsd: number;
  seniorPaidUsd: number; // what senior actually receives this period
  juniorBufferEndUsd: number; // buffer after absorbing shortfall / keeping excess
  bufferBreached: boolean; // buffer hit zero → senior no longer fully protected
  uncoveredUsd: number; // shortfall the buffer could NOT cover (senior eats this)
}

export function accrueCoupon(
  seniorCapUsd: Decimal | number,
  couponAnnual: Decimal | number,
  dtYears: Decimal | number,
): Decimal {
  return D(seniorCapUsd).mul(D(couponAnnual)).mul(D(dtYears));
}

export function settlePeriod(p: PeriodEconomics): PeriodSettlement {
  const couponOwed = accrueCoupon(p.seniorCapUsd, p.couponAnnual, p.dtYears);
  const seniorRealized = D(p.seniorFeesUsd)
    .plus(D(p.fundingUsd))
    .minus(D(p.seniorIlUsd));

  const rawShortfall = Decimal.max(D(0), couponOwed.minus(seniorRealized));
  const excess = Decimal.max(D(0), seniorRealized.minus(couponOwed));

  const buffer = D(p.juniorBufferUsd);
  const covered = Decimal.min(rawShortfall, Decimal.max(D(0), buffer));
  const uncovered = rawShortfall.minus(covered);

  // Junior buffer: loses what it covers, gains the senior's excess (its upside).
  const bufferEnd = buffer.minus(covered).plus(excess);
  const seniorPaid = couponOwed.minus(uncovered); // full coupon unless buffer ran out

  return {
    couponOwedUsd: couponOwed.toNumber(),
    seniorRealizedUsd: seniorRealized.toNumber(),
    shortfallUsd: rawShortfall.toNumber(),
    excessUsd: excess.toNumber(),
    seniorPaidUsd: seniorPaid.toNumber(),
    juniorBufferEndUsd: bufferEnd.toNumber(),
    bufferBreached: covered.lt(rawShortfall),
    uncoveredUsd: uncovered.toNumber(),
  };
}
