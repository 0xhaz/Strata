"use client";

import { useEffect, useRef, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface Cycle {
  i: number;
  ts: number;
  action: string;
  reason: string;
  price: number;
  fundingAnnualized: number;
  carry: "carry" | "cost" | "flat";
  deltaSol: number;
  currentShortSol: number;
  targetShortSol: number;
  driftPct: number;
  unhedgedUsd: number;
}
interface Feed {
  running: boolean;
  startedAt: number;
  lastUpdate: number;
  intervalSec: number;
  asset?: string;
  config?: { seniorShare: number; h: number; couponC: number; threshold: number; juniorBufferUsd: number };
  summary: { cycles: number; rebalances: number; holds?: number; skips?: number };
  cycles: Cycle[];
}

const POLL_MS = 2000;

export function LiveFeed() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [now, setNow] = useState(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/live", { cache: "no-store" });
        setFeed(await r.json());
      } catch {
        /* keep last */
      }
      setNow(Date.now());
    };
    tick();
    timer.current = setInterval(tick, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // "Live" if the feed updated within ~2.5 wake intervals (and the loop says running).
  const interval = feed?.intervalSec ?? 15;
  const fresh = feed ? now - feed.lastUpdate < interval * 2500 : false;
  const isLive = !!feed?.running && fresh;
  const asset = feed?.asset ?? "mETH";
  const last = feed?.cycles?.[feed.cycles.length - 1];
  const rows = feed?.cycles ? [...feed.cycles].reverse() : [];

  return (
    <>
    <SiteHeader
      right={
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
          <span className={`inline-block h-2 w-2 rounded-full ${isLive ? "animate-pulse bg-emerald-500" : "bg-zinc-500"}`} />
          {isLive ? "LIVE" : "idle"}
        </span>
      }
    />
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Live agent</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          The autonomous wake loop, streaming live. Each cycle reads both Byreal skills, decides, reports yield on-chain, and journals.
        </p>
      </div>

      {!feed || feed.cycles.length === 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Waiting for the agent…</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>No live cycles yet. Start the autonomous loop and this page will stream it:</p>
            <pre className="rounded-md border bg-black/30 p-3 font-mono text-xs">cd tranche-strategy && pnpm agent-loop --ticks 0 --interval 15</pre>
            <p><code>--ticks 0</code> runs until you stop it (Ctrl+C). This page polls every {POLL_MS / 1000}s.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Live KPI strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Cycle" value={`#${last?.i ?? 0}`} sub={`${feed.summary.cycles} total`} />
            <Stat label={`${asset} price`} value={last ? `$${last.price.toFixed(2)}` : "—"} color="text-sky-400" />
            <Stat label="Funding" value={last ? `${(last.fundingAnnualized * 100).toFixed(1)}%` : "—"} sub={last?.carry} color={last?.carry === "carry" ? "text-emerald-400" : last?.carry === "cost" ? "text-rose-400" : undefined} />
            <Stat label="Hedge (short)" value={last ? `${last.currentShortSol.toFixed(2)} ETH` : "—"} color="text-amber-400" />
            <Stat label="Drift" value={last ? `${(last.driftPct * 100).toFixed(2)}%` : "—"} sub={`T ${((feed.config?.threshold ?? 0.06) * 100).toFixed(0)}%`} />
            <Stat label="Rebalances" value={String(feed.summary.rebalances)} sub={`${feed.summary.holds ?? 0} holds`} />
          </div>

          {/* Sparkline: price + held short over cycles */}
          <Card>
            <CardHeader><CardTitle className="text-base">Hedge tracking <span className="text-xs font-normal text-muted-foreground">— the ETH short tracks the live {asset} delta</span></CardTitle></CardHeader>
            <CardContent><Spark cycles={feed.cycles} /></CardContent>
          </Card>

          {/* Streaming decision log (newest first) */}
          <Card>
            <CardHeader><CardTitle className="text-base">Decision stream</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">#</TableHead>
                    <TableHead className="w-[100px]">Action</TableHead>
                    <TableHead className="w-[90px]">Price</TableHead>
                    <TableHead className="w-[120px]">Short→tgt</TableHead>
                    <TableHead className="w-[70px]">Drift</TableHead>
                    <TableHead className="w-[80px]">Funding</TableHead>
                    <TableHead>Rationale</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => (
                    <TableRow key={c.i} className={c.i === last?.i ? "bg-emerald-500/5" : ""}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{c.i}</TableCell>
                      <TableCell><ActionBadge action={c.action} /></TableCell>
                      <TableCell className="font-mono text-xs">{c.price > 0 ? c.price.toFixed(2) : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{c.currentShortSol.toFixed(1)} → {c.targetShortSol.toFixed(1)}</TableCell>
                      <TableCell className="font-mono text-xs">{(c.driftPct * 100).toFixed(1)}%</TableCell>
                      <TableCell className={`text-xs ${c.carry === "carry" ? "text-emerald-400" : c.carry === "cost" ? "text-rose-400" : "text-muted-foreground"}`}>{c.carry}</TableCell>
                      <TableCell className="max-w-0 truncate text-xs text-muted-foreground" title={c.reason}>{c.reason}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground">
            Live signing/broadcast is the agent-token handoff (onboarding dep) — resizes are paper-applied. Decisions are journaled append-only.
          </p>
        </div>
      )}
    </main>
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="gap-0 py-3.5">
      <CardContent className="px-4">
        <div className="text-[13px] text-muted-foreground">{label}</div>
        <div className={`mt-0.5 text-xl font-semibold tabular-nums ${color ?? "text-foreground"}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, string> = {
    rebalance: "border-sky-500/40 text-sky-400",
    "re-range": "border-amber-500/40 text-amber-400",
    hold: "border-zinc-500/40 text-zinc-400",
    "skip-stale": "border-rose-500/40 text-rose-400",
  };
  return <Badge variant="outline" className={`text-[10px] uppercase ${map[action] ?? ""}`}>{action}</Badge>;
}

function Spark({ cycles }: { cycles: Cycle[] }) {
  const pts = cycles.filter((c) => c.price > 0);
  if (pts.length < 2) return <p className="text-xs text-muted-foreground">Collecting cycles…</p>;
  const W = 900, H = 120, PAD = 8;
  const xs = (i: number) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const prices = pts.map((p) => p.price);
  const shorts = pts.map((p) => p.targetShortSol);
  const scale = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals), d = hi - lo || 1;
    return (v: number) => H - PAD - ((v - lo) / d) * (H - 2 * PAD);
  };
  const yP = scale(prices), yS = scale(shorts);
  const path = (vals: number[], y: (v: number) => number) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${xs(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <path d={path(prices, yP)} className="stroke-sky-400 fill-none" strokeWidth="1.5" />
      <path d={path(shorts, yS)} className="stroke-amber-400 fill-none" strokeWidth="1.5" strokeDasharray="4 2" />
      {pts.map((c, i) => (c.action === "rebalance" || c.action === "re-range") ? <circle key={i} cx={xs(i)} cy={yS(c.targetShortSol)} r="2.5" className="fill-sky-400" /> : null)}
      <text x={PAD} y={12} className="fill-sky-400" fontSize="10">price</text>
      <text x={PAD + 70} y={12} className="fill-amber-400" fontSize="10">target short</text>
    </svg>
  );
}
