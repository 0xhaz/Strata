/**
 * Live deploy-preview math. Uses the SHARED tranche-strategy lib (single source of
 * truth) — the same functions the agent runs, so the preview equals reality.
 */
import {
  trancheParams,
  clmmSolFraction,
  targetShort,
  DEFAULT_THRESHOLD,
} from "@/lib/strata-core";

export interface PreviewInput {
  totalUsd: number;
  juniorPct: number; // 0..1
  entry: number;
  widthPct: number; // e.g. 0.15 for ±15%
}

export interface Preview {
  senior: number;
  junior: number;
  juniorShare: number;
  seniorShare: number;
  h: number;
  c: number;
  protection: number;
  threshold: number;
  range: { lower: number; upper: number };
  deltaSol: number;
  shortSol: number;
  shortUsd: number;
  seniorCouponUsdYr: number;
  juniorBufferUsd: number;
}

export function computePreview({ totalUsd, juniorPct, entry, widthPct }: PreviewInput): Preview {
  const junior = totalUsd * juniorPct;
  const senior = totalUsd - junior;
  const p = trancheParams({ seniorCapUsd: senior, juniorCapUsd: junior });
  const range = { lower: entry * (1 - widthPct), upper: entry * (1 + widthPct) };
  const fraction = entry > 0 ? clmmSolFraction(entry, range) : 0;
  const deltaSol = entry > 0 ? (fraction * totalUsd) / entry : 0;
  const hedge = targetShort(deltaSol, p.seniorShare, p.h, entry);
  return {
    senior,
    junior,
    juniorShare: p.juniorShare,
    seniorShare: p.seniorShare,
    h: p.h,
    c: p.c,
    protection: p.protection,
    threshold: DEFAULT_THRESHOLD,
    range,
    deltaSol,
    shortSol: hedge.shortSol,
    shortUsd: hedge.shortUsd,
    seniorCouponUsdYr: senior * p.c,
    juniorBufferUsd: junior,
  };
}
