"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { computePreview } from "@/lib/preview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { SiteHeader } from "@/components/site-header";

// Wallet button touches `window` — load client-only to avoid SSR hydration mismatch.
const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

const usd = (n: number, dp = 0) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;

interface Market {
  pool: { id: string; pair: string; price: number; totalAprPct: number; feeRateBps: number; tvlUsd: number } | null;
  funding: { annualized: number; classification: "carry" | "cost" | "flat"; markPrice: number } | null;
  errors: string[];
}

const SOL_MINT = "So11111111111111111111111111111111111111112";

export function OperatorApp() {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [market, setMarket] = useState<Market | null>(null);
  const [balanceSol, setBalanceSol] = useState<number | null>(null);

  const [totalUsd, setTotalUsd] = useState(10_000);
  const [juniorPct, setJuniorPct] = useState(0.4);
  const [widthPct, setWidthPct] = useState(0.15);

  const [building, setBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<{ ok: boolean; unsignedTx?: unknown; error?: string } | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<{ ok: boolean; summary?: Record<string, unknown>; error?: string } | null>(null);

  // Live market (pool price + funding) from the real CLIs.
  useEffect(() => {
    let on = true;
    fetch("/api/market")
      .then((r) => r.json())
      .then((m: Market) => on && setMarket(m))
      .catch(() => on && setMarket({ pool: null, funding: null, errors: ["market unreachable"] }));
    return () => {
      on = false;
    };
  }, []);

  // Devnet balance on connect.
  useEffect(() => {
    if (!publicKey) {
      setBalanceSol(null);
      return;
    }
    let on = true;
    connection
      .getBalance(publicKey)
      .then((lamports) => on && setBalanceSol(lamports / LAMPORTS_PER_SOL))
      .catch(() => on && setBalanceSol(null));
    return () => {
      on = false;
    };
  }, [publicKey, connection]);

  const entry = market?.pool?.price && market.pool.price > 0 ? market.pool.price : 150;
  const preview = useMemo(
    () => computePreview({ totalUsd, juniorPct, entry, widthPct }),
    [totalUsd, juniorPct, entry, widthPct],
  );

  async function buildTx() {
    if (!publicKey || !market?.pool) return;
    setBuilding(true);
    setBuildResult(null);
    try {
      const res = await fetch("/api/deploy/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pool: market.pool.id,
          priceLower: preview.range.lower,
          priceUpper: preview.range.upper,
          baseMint: SOL_MINT,
          amount: preview.senior + preview.junior,
          walletAddress: publicKey.toBase58(),
        }),
      });
      setBuildResult(await res.json());
    } catch (e) {
      setBuildResult({ ok: false, error: (e as Error).message });
    } finally {
      setBuilding(false);
    }
  }

  async function simulate() {
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ senior: preview.senior, junior: preview.junior, entry, width: widthPct }),
      });
      setSimResult(await res.json());
    } catch (e) {
      setSimResult({ ok: false, error: (e as Error).message });
    } finally {
      setSimulating(false);
    }
  }

  return (
    <>
    <SiteHeader right={<WalletMultiButton style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)", height: 36, fontSize: 13, borderRadius: 8 }} />} />
    <div className="mx-auto w-full max-w-6xl px-5 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Strategy lab</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Configure &amp; simulate the delta-neutral tranche strategy. The live product is{" "}
          <Link href="/mantle" className="text-violet-400 hover:underline">the RWA vaults on Mantle →</Link>.
        </p>
      </div>

      {/* Live market strip */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-card/40 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">Live market</span>
        {market === null ? (
          <span className="text-muted-foreground">loading…</span>
        ) : market.pool ? (
          <>
            <span>SOL <b className="font-mono text-sky-400">{usd(market.pool.price, 2)}</b></span>
            <span>pool APR <b className="font-mono text-emerald-400">{market.pool.totalAprPct.toFixed(1)}%</b></span>
            <span>fee <b className="font-mono">{market.pool.feeRateBps}bps</b></span>
            {market.funding && (
              <span>
                funding{" "}
                <b className={`font-mono ${market.funding.classification === "carry" ? "text-emerald-400" : market.funding.classification === "cost" ? "text-rose-400" : ""}`}>
                  {pct(market.funding.annualized, 1)} {market.funding.classification}
                </b>
              </span>
            )}
            <Badge variant="outline" className="ml-auto border-emerald-500/40 text-emerald-400 text-[10px]">byreal-cli live</Badge>
          </>
        ) : (
          <span className="text-amber-400">market unreachable — using entry {usd(entry, 0)} fallback</span>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── LEFT: Configure + Deploy ── */}
        <div className="space-y-5">
          {/* Wallet status */}
          <Card>
            <CardHeader><CardTitle className="text-base">1 · Connect your wallet</CardTitle></CardHeader>
            <CardContent>
              {connected && publicKey ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{publicKey.toBase58().slice(0, 6)}…{publicKey.toBase58().slice(-6)}</span>
                  <span>devnet balance <b className="font-mono">{balanceSol === null ? "…" : `${balanceSol.toFixed(3)} SOL`}</b></span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Connect a Solana wallet (devnet) to deploy. You sign nothing here yet — the agent builds unsigned transactions for review.</p>
              )}
            </CardContent>
          </Card>

          {/* Configure */}
          <Card>
            <CardHeader><CardTitle className="text-base">2 · Configure the tranche</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="capital">Your capital (USDC)</Label>
                <Input
                  id="capital"
                  type="number"
                  value={totalUsd}
                  min={100}
                  step={500}
                  onChange={(e) => setTotalUsd(Math.max(0, Number(e.target.value)))}
                  className="font-mono"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label>Senior / Junior split</Label>
                  <span className="text-xs text-muted-foreground">
                    <span className="text-sky-400">senior {pct(1 - juniorPct, 0)}</span> · <span className="text-violet-400">junior {pct(juniorPct, 0)}</span>
                  </span>
                </div>
                <Slider value={[juniorPct * 100]} min={5} max={70} step={1} onValueChange={([v]) => setJuniorPct((v ?? 40) / 100)} />
                <div className="flex h-2 w-full overflow-hidden rounded-full">
                  <div className="bg-sky-500" style={{ width: `${(1 - juniorPct) * 100}%` }} />
                  <div className="bg-violet-500" style={{ width: `${juniorPct * 100}%` }} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <Label>LP range width</Label>
                  <span className="font-mono text-xs text-muted-foreground">±{pct(widthPct, 0)} · [{preview.range.lower.toFixed(1)}, {preview.range.upper.toFixed(1)}]</span>
                </div>
                <Slider value={[widthPct * 100]} min={5} max={40} step={1} onValueChange={([v]) => setWidthPct((v ?? 15) / 100)} />
              </div>
            </CardContent>
          </Card>

          {/* Deploy */}
          <Card>
            <CardHeader><CardTitle className="text-base">3 · Review &amp; deploy</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5 rounded-lg border bg-card/40 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Open LP (Byreal CLMM, Solana)</span><span className="font-mono">{usd(totalUsd)} · [{preview.range.lower.toFixed(1)}, {preview.range.upper.toFixed(1)}]</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Open hedge (Byreal Perps, Hyperliquid)</span><span className="font-mono">short {preview.shortSol.toFixed(2)} SOL ({usd(preview.shortUsd)})</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Senior coupon target</span><span className="font-mono text-sky-400">{pct(preview.c, 2)} · {usd(preview.seniorCouponUsdYr, 0)}/yr</span></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={buildTx} disabled={!connected || !market?.pool || building} variant="secondary">
                  {building ? "Building…" : "Build unsigned tx"}
                </Button>
                <Button disabled title="Requires the agent-token signing skill (onboarding dependency)">
                  Authorize via agent-token ⛔
                </Button>
                <Button onClick={simulate} disabled={simulating} variant="outline">
                  {simulating ? "Simulating…" : "Simulate strategy"}
                </Button>
              </div>

              {buildResult && (
                <div className="rounded-lg border bg-black/30 p-3 text-xs">
                  {buildResult.ok ? (
                    <>
                      <div className="mb-1 text-emerald-400">Unsigned open-position tx built (no key touched) — ready for agent-token:</div>
                      <pre className="max-h-44 overflow-auto font-mono text-[11px] text-muted-foreground">{JSON.stringify(buildResult.unsignedTx, null, 2).slice(0, 1400)}</pre>
                    </>
                  ) : (
                    <div className="text-amber-400">Build returned: {buildResult.error}</div>
                  )}
                </div>
              )}

              {simResult && (
                <div className="rounded-lg border bg-card/40 p-3 text-sm">
                  {simResult.ok ? (
                    <div className="flex items-center justify-between">
                      <span className="text-emerald-400">Simulated {String(simResult.summary?.rebalances ?? "")} rebalances over the run.</span>
                      <Link href="/manage" className="text-sky-400 hover:underline">Open Manage dashboard →</Link>
                    </div>
                  ) : (
                    <span className="text-amber-400">{simResult.error}</span>
                  )}
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Nothing is signed here. The agent builds an UNSIGNED transaction and hands it to the agent-token skill for
                signing + broadcast (testnet only). Senior is delta-hedged, not riskless.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: live preview (the shared lib math) ── */}
        <div>
          <Card className="lg:sticky lg:top-6">
            <CardHeader><CardTitle className="text-base">Strategy preview <span className="text-xs font-normal text-muted-foreground">— computed by the agent&apos;s own math</span></CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Senior" value={usd(preview.senior)} sub={pct(preview.seniorShare, 0)} color="text-sky-400" />
                <Stat label="Junior" value={usd(preview.junior)} sub={pct(preview.juniorShare, 0)} color="text-violet-400" />
              </div>

              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Metric label="Hedge h" value={preview.h.toFixed(2)} />
                <Metric label="Coupon c" value={pct(preview.c, 2)} />
                <Metric label="Protection" value={pct(preview.protection, 0)} />
                <Metric label="Threshold T" value={pct(preview.threshold, 0)} />
              </dl>

              <div className="rounded-lg border bg-card/40 p-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">LP delta (derived)</span><span className="font-mono">{preview.deltaSol.toFixed(2)} SOL</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Senior hedge (short)</span><span className="font-mono text-amber-400">{preview.shortSol.toFixed(2)} SOL · {usd(preview.shortUsd)}</span></div>
                <div className="mt-2 flex justify-between"><span className="text-muted-foreground">Junior buffer</span><span className="font-mono">{usd(preview.juniorBufferUsd)}</span></div>
                <Progress value={Math.min(100, (preview.juniorShare / 0.5) * 100)} className="mt-1.5 h-1.5" />
              </div>

              <p className="text-xs text-muted-foreground">
                h and c are set dynamically from your split by a capped rate curve (caps: h≤1, c≤12%, protection≤35%). Funding
                carry, when positive, is upside on top of c — never baseline.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg border bg-card/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub} of capital</div>
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
