/**
 * Money-math helpers. Per CLAUDE.md: never use JS floats for position/coupon math.
 * All sizing, coupon, and accounting math goes through decimal.js. Geometric ratios
 * (e.g. the CLMM value-fraction, a unitless number) may use Number — they are not money.
 */
import Decimal from "decimal.js";

// Match perps-cli precision conventions: 28 significant digits, round-half-up.
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export type Numeric = Decimal | number | string;

export const D = (x: Numeric): Decimal => new Decimal(x);

/** Year fraction between two unix-ms timestamps (365-day year, matches sim DT). */
export const yearFraction = (fromMs: number, toMs: number): Decimal =>
  D(Math.max(0, toMs - fromMs)).div(D(365).mul(24).mul(60).mul(60).mul(1000));

/** Clamp a Decimal to [lo, hi]. */
export const clamp = (x: Decimal, lo: Numeric, hi: Numeric): Decimal =>
  Decimal.max(D(lo), Decimal.min(D(hi), x));
