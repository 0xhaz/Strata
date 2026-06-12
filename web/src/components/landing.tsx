"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { VAULTS, VAULT_KEYS, readVault, type VaultState } from "@/lib/mantle";
import { SiteHeader } from "./site-header";
import { Button } from "@/components/ui/button";

const fmt = (v: bigint, dp = 2) => Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: dp });

export function Landing() {
  const [stats, setStats] = useState<Record<string, VaultState | null>>({});

  useEffect(() => {
    let on = true;
    VAULT_KEYS.forEach(async (k) => {
      try {
        const s = await readVault(VAULTS[k]);
        if (on) setStats((p) => ({ ...p, [k]: s }));
      } catch { /* RPC flaky — fall back to seeded copy */ }
    });
    return () => { on = false; };
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        right={
          <Button asChild size="sm">
            <Link href="/mantle">Open the vaults</Link>
          </Button>
        }
      />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[28rem] w-[48rem] -translate-x-1/2 rounded-full bg-gradient-to-br from-violet-600/25 via-sky-500/15 to-transparent blur-3xl" />
        <div className="relative mx-auto w-full max-w-5xl px-5 py-20 text-center sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
            AI × RWA · live on Mantle
          </span>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-6xl">
            AI-managed RWA yield,<br />
            <span className="bg-gradient-to-r from-violet-300 to-sky-300 bg-clip-text text-transparent">tranched on Mantle</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
            Strata turns idle <span className="text-foreground">mETH</span> and{" "}
            <span className="text-foreground">USDY</span> into delta-neutral, risk-tranched yield.
            An autonomous agent runs the strategy and settles it on-chain — you hold protected{" "}
            <span className="text-sky-300">senior</span> or levered{" "}
            <span className="text-violet-300">junior</span> tranche tokens.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg"><Link href="/mantle">Open the vaults →</Link></Button>
            <Button asChild size="lg" variant="outline"><Link href="/live">Watch the agent</Link></Button>
          </div>

          {/* live stats */}
          <dl className="mx-auto mt-14 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border/60 text-left">
            <Metric label="Total value locked" value={`${fmt((stats.mETH?.tvl ?? 0n) + (stats.USDY?.tvl ?? 0n) || 0n)} `} sub="mETH + USDY, live" />
            <Metric label="RWA vaults" value={String(VAULT_KEYS.length)} sub="mETH · USDY" />
            <Metric label="Junior NAV / share" value={stats.mETH ? Number(formatEther(stats.mETH.juniorNav)).toFixed(4) : "1.0000"} sub="grows with yield" />
          </dl>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="mx-auto w-full max-w-5xl px-5 py-12">
        <h2 className="mb-8 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Step n="1" title="Deposit your RWA" body="Put idle mETH or USDY into a senior (protected) or junior (levered) tranche and receive ERC-20 tranche tokens. KYC-gated." />
          <Step n="2" title="The agent earns, hedged" body="An autonomous AI agent captures the asset's yield and hedges the price on Hyperliquid — delta-neutral, Ethena-style." />
          <Step n="3" title="Settled on Mantle" body="The agent reports realized yield on-chain via settle(). Junior NAV rises; senior is protected. Redeem at NAV anytime." />
        </div>
      </section>

      {/* ── Vaults ── */}
      <section className="mx-auto w-full max-w-5xl px-5 py-12">
        <h2 className="mb-6 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground">Live vaults on Mantle</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {VAULT_KEYS.map((k) => {
            const s = stats[k];
            return (
              <Link key={k} href="/mantle" className="group relative overflow-hidden rounded-2xl border bg-card/40 p-6 transition hover:border-violet-500/40 hover:bg-card/70">
                <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-gradient-to-br from-violet-500/10 to-transparent blur-2xl transition group-hover:from-violet-500/20" />
                <div className="relative">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xl font-semibold">{VAULTS[k].symbol} vault</span>
                    <span className="font-mono text-sm text-muted-foreground">{(VAULTS[k].couponBps / 100).toFixed(2)}% coupon</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{VAULTS[k].strategy}</p>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-xs text-muted-foreground">TVL</div>
                      <div className="font-mono text-lg">{s ? `${fmt(s.tvl)} ${VAULTS[k].symbol}` : "—"}</div>
                    </div>
                    <span className="text-sm text-violet-300 transition group-hover:translate-x-0.5">Deposit →</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <footer className="mt-auto border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground">
          <span>Strata · AI-managed RWA yield, tranched on Mantle</span>
          <span className="flex items-center gap-3">
            <a className="hover:text-foreground" href={`https://sepolia.mantlescan.xyz/address/${VAULTS.mETH.TrancheVault}#code`} target="_blank" rel="noreferrer">verified contracts ↗</a>
            <span>Mantle Sepolia</span>
          </span>
        </div>
      </footer>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-background px-5 py-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card/40 p-6">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 font-mono text-sm text-violet-300">{n}</div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
