import { loadReplay, fmtUsd, fmtPct, type Frame } from "@/lib/replay";
import { ReplayCharts } from "@/components/replay-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SiteHeader } from "@/components/site-header";

export async function ManageView() {
  const { data, live } = await loadReplay();
  const { meta, summary, frames } = data;
  const { params, allocation } = meta;

  const notable = frames.filter((f) => f.action !== "hold").slice(-12).reverse();
  const total = allocation.seniorCapUsd + allocation.juniorCapUsd;

  return (
    <>
    <SiteHeader />
    <main className="mx-auto w-full max-w-6xl px-5 py-10">
      {/* ── Header ── */}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Track record</h1>
          <Badge variant="outline" className="border-amber-500/40 text-amber-400">
            {live ? "live artifact" : "replay · sim"}
          </Badge>
          <Badge variant="outline" className="border-sky-500/40 text-sky-400">
            {meta.network}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground">
            seed {meta.generatedFromSeed}
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          A recorded run of the autonomous agent holding a delta-neutral tranche through a price
          swing — the verifiable track record. Every rebalance + rationale is journaled.
        </p>
      </header>

      {/* ── KPI row ── */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="SOL swing" value={`${summary.minPrice.toFixed(0)}–${summary.maxPrice.toFixed(0)}`} sub={`entry ${meta.entry}`} />
        <Stat label="Wake cycles" value={String(meta.wakes)} sub={`every ${meta.wakeIntervalMin}m`} />
        <Stat label="Rebalances" value={String(summary.rebalances)} sub={fmtPct(summary.rebalancePerWake)} />
        <Stat label="Range exits" value={String(summary.rangeExitWakes)} sub={summary.rangeExitWakes === 0 ? "held in range" : "re-ranged"} />
        <Stat label="Funding carry" value={`${summary.carryWakes}/${meta.wakes}`} sub="wakes paid to short" accent="emerald" />
        <Stat label="Peak unhedged" value={fmtUsd(summary.peakUnhedgedSeniorUsd)} sub="senior tracking err" accent="rose" />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Chart (centerpiece) ── */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Holding senior delta-neutral through the swing</CardTitle>
          </CardHeader>
          <CardContent>
            <ReplayCharts data={data} />
          </CardContent>
        </Card>

        {/* ── Tranche structure ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tranche structure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between text-sm">
                <span className="text-sky-400">Senior · {fmtPct(params.seniorShare, 0)}</span>
                <span className="font-mono">{fmtUsd(allocation.seniorCapUsd)}</span>
              </div>
              <SplitBar seniorShare={params.seniorShare} />
              <div className="mt-1.5 flex items-baseline justify-between text-sm">
                <span className="text-violet-400">Junior · {fmtPct(params.juniorShare, 0)}</span>
                <span className="font-mono">{fmtUsd(allocation.juniorCapUsd)}</span>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Metric label="Hedge ratio h" value={params.h.toFixed(2)} />
              <Metric label="Coupon c" value={fmtPct(params.c, 2)} />
              <Metric label="Protection" value={fmtPct(params.protection, 0)} />
              <Metric label="Threshold T" value={fmtPct(meta.thresholdT, 0)} />
            </dl>

            <div className="rounded-lg border bg-card/40 p-3 text-xs text-muted-foreground">
              <div className="mb-1 flex items-center justify-between">
                <span>Junior buffer</span>
                <span className="font-mono text-foreground">
                  {fmtUsd(summary.finalJuniorBufferUsd)} / {fmtUsd(allocation.juniorCapUsd)}
                </span>
              </div>
              <Progress value={(summary.finalJuniorBufferUsd / allocation.juniorCapUsd) * 100} className="h-1.5" />
              <p className="mt-2">
                Senior coupon paid to date:{" "}
                <span className="font-mono text-foreground">{fmtUsd(summary.seniorPaidToDateUsd, 2)}</span>. Junior absorbs
                shortfalls first, keeps the excess, never goes below zero.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Decision log ── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            On-chain decision log{" "}
            <span className="text-sm font-normal text-muted-foreground">
              — every rebalance + rationale, the verifiability story
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[90px]">Action</TableHead>
                <TableHead className="w-[80px]">Price</TableHead>
                <TableHead className="w-[120px]">Short Δ (SOL)</TableHead>
                <TableHead className="w-[70px]">Drift</TableHead>
                <TableHead className="w-[90px]">Funding</TableHead>
                <TableHead>Rationale</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notable.map((f, i) => (
                <DecisionRow key={i} f={f} />
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Showing the {notable.length} most recent non-hold decisions of {meta.wakes} cycles. Each is journaled
            append-only and anchored on Mantle once the logging contract address lands (onboarding dependency).
          </p>
        </CardContent>
      </Card>

      {/* ── Honesty / status ── */}
      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Composition (load-bearing, not cosmetic)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Dep ok label="Pure tranche math + 47 unit tests" note="our only original code" />
            <Dep ok label="Byreal CLMM yield leg" note="byreal-cli — composed, -o json" />
            <Dep ok label="Byreal Perps hedge leg" note="byreal-perps-cli — Hyperliquid" />
            <Dep label="agent-token signing / bridge" note="onboarding dep — never faked" />
            <Dep label="Mantle decision-log contract" note="onboarding dep — journals locally meanwhile" />
            <Dep label="ERC-8004 identity NFT" note="onboarding dep — needs registry addr" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Honest framing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              Senior is <span className="text-foreground">delta-hedged, not riskless</span>. A linear perp can&apos;t
              fully neutralize IL/gamma; in a gap or range-exit the senior eats tracking error (the rose band).
            </p>
            <p>
              The value is <span className="text-foreground">novelty + verifiability + the junior&apos;s levered
              exposure</span>, not a market-beating ~{fmtPct(params.c, 1)} coupon.
            </p>
            <p className="text-xs">{meta.note}</p>
          </CardContent>
        </Card>
      </section>

      <footer className="mt-8 text-center text-xs text-muted-foreground">
        {fmtPct(params.juniorShare, 0)} junior · h={params.h.toFixed(2)} · c={fmtPct(params.c, 2)} · T={fmtPct(meta.thresholdT, 0)}
        {"  ·  "}capital {fmtUsd(total)} (single-user, never pooled)
      </footer>
    </main>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "emerald" | "rose";
}) {
  const color = accent === "emerald" ? "text-emerald-400" : accent === "rose" ? "text-rose-400" : "text-foreground";
  return (
    <Card className="gap-0 py-3.5">
      <CardContent className="px-4">
        <div className="text-[13px] text-muted-foreground">{label}</div>
        <div className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function SplitBar({ seniorShare }: { seniorShare: number }) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full">
      <div className="bg-sky-500" style={{ width: `${seniorShare * 100}%` }} />
      <div className="bg-violet-500" style={{ width: `${(1 - seniorShare) * 100}%` }} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-base">{value}</dd>
    </div>
  );
}

function DecisionRow({ f }: { f: Frame }) {
  const variant =
    f.action === "rebalance" ? "default" : f.action === "re-range" ? "destructive" : "secondary";
  const delta = f.targetShortSol - f.currentShortSol;
  return (
    <TableRow>
      <TableCell>
        <Badge variant={variant} className="text-[10px] uppercase">
          {f.action}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs">{f.price.toFixed(2)}</TableCell>
      <TableCell className="font-mono text-xs">
        {f.currentShortSol.toFixed(1)} → {f.targetShortSol.toFixed(1)}
        <span className={delta >= 0 ? "text-emerald-400" : "text-rose-400"}>
          {" "}({delta >= 0 ? "+" : ""}{delta.toFixed(1)})
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{(f.driftPct * 100).toFixed(1)}%</TableCell>
      <TableCell>
        <span
          className={
            f.funding.carryOrCost === "carry"
              ? "text-emerald-400"
              : f.funding.carryOrCost === "cost"
                ? "text-rose-400"
                : "text-muted-foreground"
          }
        >
          {f.funding.carryOrCost}
        </span>
      </TableCell>
      <TableCell className="max-w-0 truncate text-xs text-muted-foreground" title={f.reason}>
        {f.reason}
      </TableCell>
    </TableRow>
  );
}

function Dep({ ok, label, note }: { ok?: boolean; label: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      <span className="text-foreground">{label}</span>
      <span className="ml-auto text-xs text-muted-foreground">{note}</span>
    </div>
  );
}
