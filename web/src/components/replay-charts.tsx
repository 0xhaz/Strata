"use client";

import { useMemo, useState } from "react";
import type { Frame, ReplayArtifact } from "@/lib/replay";

const fmt = (n: number, dp = 1) => n.toFixed(dp);
const fmtUsd = (n: number, dp = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

interface Props {
  data: ReplayArtifact;
}

// Plot geometry
const W = 920;
const PAD_L = 52;
const PAD_R = 16;
const innerW = W - PAD_L - PAD_R;

function xScale(i: number, n: number) {
  return PAD_L + (i / (n - 1)) * innerW;
}
function yScale(v: number, lo: number, hi: number, top: number, h: number) {
  if (hi === lo) return top + h / 2;
  return top + h - ((v - lo) / (hi - lo)) * h;
}

function path(
  frames: Frame[],
  get: (f: Frame) => number,
  lo: number,
  hi: number,
  top: number,
  h: number,
) {
  return frames
    .map((f, i) => `${i === 0 ? "M" : "L"}${xScale(i, frames.length).toFixed(1)},${yScale(get(f), lo, hi, top, h).toFixed(1)}`)
    .join(" ");
}

export function ReplayCharts({ data }: Props) {
  const frames = data.frames;
  const n = frames.length;
  const [hover, setHover] = useState<number | null>(null);

  const ranges = useMemo(() => {
    const prices = frames.map((f) => f.price);
    const shorts = frames.flatMap((f) => [f.currentShortSol, f.targetShortSol, f.deltaSol]);
    const funds = frames.map((f) => f.fundingAnnualized);
    const pad = (lo: number, hi: number, p = 0.06) => {
      const d = (hi - lo) * p || 1;
      return [lo - d, hi + d] as const;
    };
    const [pLo, pHi] = pad(Math.min(...prices, data.meta.range.lower), Math.max(...prices, data.meta.range.upper));
    const [sLo, sHi] = pad(0, Math.max(...shorts));
    const fAbs = Math.max(0.001, ...funds.map(Math.abs));
    return { pLo, pHi, sLo, sHi, fLo: -fAbs, fHi: fAbs };
  }, [frames, data.meta.range]);

  // Panel layout (within a 0..H viewbox)
  const P1 = { top: 8, h: 150, label: "SOL / USDC price" };
  const P2 = { top: 200, h: 120, label: "Hedge: short size vs delta-demand (SOL)" };
  const P3 = { top: 356, h: 60, label: "Funding (annualized)" };
  const H = 432;

  const hx = hover === null ? null : xScale(hover, n);
  const hf = hover === null ? null : frames[hover];

  const rangeTopY = yScale(data.meta.range.upper, ranges.pLo, ranges.pHi, P1.top, P1.h);
  const rangeBotY = yScale(data.meta.range.lower, ranges.pLo, ranges.pHi, P1.top, P1.h);
  const entryY = yScale(data.meta.entry, ranges.pLo, ranges.pHi, P1.top, P1.h);

  const rebalanceIdx = useMemo(
    () => frames.map((f, i) => (f.action === "rebalance" ? i : -1)).filter((i) => i >= 0),
    [frames],
  );

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * W;
          const frac = (px - PAD_L) / innerW;
          const idx = Math.round(frac * (n - 1));
          setHover(Math.max(0, Math.min(n - 1, idx)));
        }}
      >
        {/* ---- Panel 1: price + range band ---- */}
        <text x={PAD_L} y={P1.top - 0} className="fill-muted-foreground" fontSize="11" dy="-2">
          {P1.label}
        </text>
        <rect
          x={PAD_L}
          y={rangeTopY}
          width={innerW}
          height={Math.max(0, rangeBotY - rangeTopY)}
          className="fill-emerald-500/10"
        />
        <line x1={PAD_L} x2={W - PAD_R} y1={rangeTopY} y2={rangeTopY} className="stroke-emerald-500/40" strokeDasharray="3 3" strokeWidth="1" />
        <line x1={PAD_L} x2={W - PAD_R} y1={rangeBotY} y2={rangeBotY} className="stroke-emerald-500/40" strokeDasharray="3 3" strokeWidth="1" />
        <line x1={PAD_L} x2={W - PAD_R} y1={entryY} y2={entryY} className="stroke-muted-foreground/40" strokeWidth="1" />
        <text x={W - PAD_R} y={rangeTopY} dx="-2" dy="-3" textAnchor="end" className="fill-emerald-500/70" fontSize="9">
          range {fmt(data.meta.range.upper)}
        </text>
        <text x={W - PAD_R} y={rangeBotY} dx="-2" dy="10" textAnchor="end" className="fill-emerald-500/70" fontSize="9">
          range {fmt(data.meta.range.lower)}
        </text>
        <path d={path(frames, (f) => f.price, ranges.pLo, ranges.pHi, P1.top, P1.h)} className="stroke-sky-400 fill-none" strokeWidth="1.5" />
        {rebalanceIdx.map((i) => (
          <circle key={i} cx={xScale(i, n)} cy={yScale(frames[i]!.price, ranges.pLo, ranges.pHi, P1.top, P1.h)} r="1.6" className="fill-amber-400/70" />
        ))}

        {/* ---- Panel 2: hedge tracking (delta demand vs held short) ---- */}
        <text x={PAD_L} y={P2.top} className="fill-muted-foreground" fontSize="11" dy="-2">
          {P2.label}
        </text>
        {/* tracking-error area between held and target */}
        <path
          d={
            path(frames, (f) => f.targetShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h) +
            " " +
            frames
              .map((f, i) => `L${xScale(n - 1 - i, n).toFixed(1)},${yScale(frames[n - 1 - i]!.currentShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h).toFixed(1)}`)
              .join(" ") +
            " Z"
          }
          className="fill-rose-500/15"
        />
        <path d={path(frames, (f) => f.targetShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h)} className="stroke-violet-400 fill-none" strokeWidth="1.5" />
        <path d={path(frames, (f) => f.currentShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h)} className="stroke-amber-400 fill-none" strokeWidth="1.25" strokeDasharray="4 2" />

        {/* ---- Panel 3: funding ---- */}
        <text x={PAD_L} y={P3.top} className="fill-muted-foreground" fontSize="11" dy="-2">
          {P3.label}
        </text>
        <line x1={PAD_L} x2={W - PAD_R} y1={yScale(0, ranges.fLo, ranges.fHi, P3.top, P3.h)} y2={yScale(0, ranges.fLo, ranges.fHi, P3.top, P3.h)} className="stroke-muted-foreground/30" strokeWidth="1" />
        <path d={path(frames, (f) => f.fundingAnnualized, ranges.fLo, ranges.fHi, P3.top, P3.h)} className="stroke-teal-400 fill-none" strokeWidth="1.25" />

        {/* ---- hover scrubber ---- */}
        {hx !== null && (
          <line x1={hx} x2={hx} y1={P1.top} y2={P3.top + P3.h} className="stroke-foreground/30" strokeWidth="1" />
        )}
        {hf && hx !== null && (
          <>
            <circle cx={hx} cy={yScale(hf.price, ranges.pLo, ranges.pHi, P1.top, P1.h)} r="3" className="fill-sky-400" />
            <circle cx={hx} cy={yScale(hf.targetShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h)} r="3" className="fill-violet-400" />
            <circle cx={hx} cy={yScale(hf.currentShortSol, ranges.sLo, ranges.sHi, P2.top, P2.h)} r="3" className="fill-amber-400" />
          </>
        )}
      </svg>

      {/* legend + hover readout */}
      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <Legend color="bg-sky-400" label="SOL price" />
        <Legend color="bg-violet-400" label="target short (delta demand)" />
        <Legend color="bg-amber-400" label="held short" />
        <Legend color="bg-rose-500/40" label="tracking error (unhedged senior)" />
        <Legend color="bg-teal-400" label="funding" />
        <Legend color="bg-amber-400/70" label="rebalance" dot />
      </div>

      <div className="mt-3 rounded-lg border bg-card/40 px-4 py-2.5 text-sm">
        {hf ? (
          <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs">
            <span>price <b className="text-sky-400">{fmt(hf.price, 2)}</b></span>
            <span>delta <b>{fmt(hf.deltaSol, 2)} SOL</b></span>
            <span>target <b className="text-violet-400">{fmt(hf.targetShortSol, 2)}</b></span>
            <span>held <b className="text-amber-400">{fmt(hf.currentShortSol, 2)}</b></span>
            <span>drift <b>{(hf.driftPct * 100).toFixed(1)}%</b></span>
            <span>unhedged <b className="text-rose-400">{fmtUsd(hf.unhedgedSeniorUsd)}</b></span>
            <span className={hf.funding.carryOrCost === "carry" ? "text-emerald-400" : hf.funding.carryOrCost === "cost" ? "text-rose-400" : ""}>
              funding {hf.funding.carryOrCost} ({(hf.fundingAnnualized * 100).toFixed(1)}%)
            </span>
            <span className="uppercase tracking-wide text-muted-foreground">{hf.action}</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-xs">Hover the chart to scrub the {n}-wake timeline. The agent resizes the short (amber) to track the delta the LP demands (violet); the rose gap is the senior capital momentarily unhedged.</span>
        )}
      </div>
    </div>
  );
}

function Legend({ color, label, dot }: { color: string; label: string; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block ${dot ? "h-2 w-2 rounded-full" : "h-2 w-3 rounded-sm"} ${color}`} />
      {label}
    </span>
  );
}
