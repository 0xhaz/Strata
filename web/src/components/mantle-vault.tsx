"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatEther, parseEther, type Address } from "viem";
import { Skeleton } from "@/components/ui/skeleton";
import {
  VAULTS, VAULT_KEYS, EXPLORER, SENIOR, JUNIOR,
  VAULT_ABI, ERC20_ABI,
  connectWallet, hasInjected, walletClient, publicClient,
  readVault, readUser, type VaultState, type UserState,
} from "@/lib/mantle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SiteHeader } from "@/components/site-header";

const f = (v: bigint, dp = 4) => Number(formatEther(v)).toLocaleString("en-US", { maximumFractionDigits: dp });
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function MantleVault() {
  const [vaultKey, setVaultKey] = useState<string>(VAULT_KEYS[0]);
  const v = VAULTS[vaultKey];

  const [account, setAccount] = useState<Address | null>(null);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [user, setUser] = useState<UserState | null>(null);
  const [tranche, setTranche] = useState<number>(SENIOR);
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false); // gate client-only wallet UI (avoid hydration mismatch)
  const [rpcError, setRpcError] = useState(false);

  useEffect(() => setMounted(true), []);

  const refresh = useCallback(async () => {
    try {
      setVault(await readVault(v));
      if (account) setUser(await readUser(account, v));
      setRpcError(false);
    } catch {
      setRpcError(true); // transient Mantle RPC failure — keep last state, don't crash
    }
  }, [account, v]);

  useEffect(() => {
    setVault(null);
    setUser(null);
    refresh();
    const t = setInterval(refresh, 6000);
    return () => clearInterval(t);
  }, [refresh]);

  async function connect() {
    try {
      setAccount(await connectWallet());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function tx(run: () => Promise<`0x${string}`>, label: string) {
    if (!account) return;
    setBusy(true);
    setBusyLabel(label);
    const t = toast.loading(`${label} — confirm in MetaMask…`);
    try {
      const hash = await run();
      toast.loading(`${label} — confirming on Mantle…`, { id: t });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`${label} confirmed`, { id: t, description: `${hash.slice(0, 14)}…`, action: { label: "View", onClick: () => window.open(`${EXPLORER}/tx/${hash}`, "_blank") } });
      await refresh();
    } catch (e) {
      toast.error(`${label} failed`, { id: t, description: (e as Error).message.split("\n")[0].slice(0, 100) });
      throw e; // stop the deposit flow if the approval is rejected
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  // Open testnet faucet — mint 10 of any vault's RWA to the connected wallet. Exposed in the navbar.
  const faucetFor = (key: string) => {
    const vv = VAULTS[key];
    return tx(() => walletClient(account!).writeContract({ address: vv.asset, abi: ERC20_ABI, functionName: "mint", args: [account!, parseEther("10")] }), `Faucet 10 ${vv.symbol}`);
  };

  async function getKyc() {
    if (!account) return;
    setBusy(true);
    const t = toast.loading("Requesting compliance approval…");
    try {
      const r = await fetch("/api/mantle/kyc", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account, vaultKey }) });
      const j = await r.json();
      if (j.ok) toast.success("KYC approved (testnet)", { id: t });
      else toast.error("KYC approval failed", { id: t, description: j.error });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // One-time token approval, then deposit — kept as two explicit steps so it's clear.
  const approve = () =>
    tx(() => walletClient(account!).writeContract({ address: v.asset, abi: ERC20_ABI, functionName: "approve", args: [v.TrancheVault, parseEther("1000000")] }), `Approve ${v.symbol}`).catch(() => {});

  const deposit = () =>
    tx(() => walletClient(account!).writeContract({ address: v.TrancheVault, abi: VAULT_ABI, functionName: "deposit", args: [tranche, parseEther(amount)] }), `Deposit ${trancheName}`).catch(() => {});

  const withdraw = () =>
    tx(() => walletClient(account!).writeContract({ address: v.TrancheVault, abi: VAULT_ABI, functionName: "withdraw", args: [tranche, parseEther(amount)] }), "Redeem").catch(() => {});

  const needsApproval = !!user && user.allowance < parseEther(amount || "0");
  const insufficient = !!user && user.asset < parseEther(amount || "0");
  // Redeem burns SHARES of the selected tranche — guard against over-redeeming (the #1 revert).
  const heldShares = tranche === SENIOR ? user?.seniorShares : user?.juniorShares;
  const overRedeem = !!user && parseEther(amount || "0") > (heldShares ?? 0n);

  const trancheName = tranche === SENIOR ? "Senior" : "Junior";

  const walletBtn = account ? (
    <Badge variant="outline" className="font-mono">{short(account)}</Badge>
  ) : (
    <Button size="sm" onClick={connect} disabled={mounted && !hasInjected()}>
      {mounted && !hasInjected() ? "No EVM wallet" : "Connect MetaMask"}
    </Button>
  );

  // Navbar: testnet faucets for every vault token (need a connected wallet to mint to + pay gas).
  const headerRight = (
    <div className="flex items-center gap-2">
      {mounted && account && (
        <div className="flex items-center gap-1.5">
          <span className="hidden text-xs text-muted-foreground sm:inline">Faucet</span>
          {VAULT_KEYS.map((k) => (
            <Button key={k} size="sm" variant="outline" onClick={() => faucetFor(k)} disabled={busy}>
              {VAULTS[k].symbol}
            </Button>
          ))}
        </div>
      )}
      {walletBtn}
    </div>
  );

  return (
    <>
      <SiteHeader right={headerRight} />
      <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">RWA Yield Vaults</h1>
          <Badge variant="outline" className="border-violet-500/40 text-violet-400">pooled</Badge>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Mantle Sepolia</Badge>
        </div>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Put idle Mantle RWAs to work — an AI agent runs risk-managed, tranched yield, settled on Mantle.
        </p>
      </div>

      {/* Vault selector */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {VAULT_KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setVaultKey(k)}
            className={`rounded-xl border px-5 py-4 text-left transition ${k === vaultKey ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/30" : "border-border bg-card/40 hover:bg-card/70"}`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-base font-semibold">{VAULTS[k].symbol} vault</span>
              <span className="font-mono text-sm text-muted-foreground">{(VAULTS[k].couponBps / 100).toFixed(2)}%</span>
            </div>
            <div className="mt-1 text-sm text-muted-foreground">{VAULTS[k].strategy}</div>
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Pool (live on-chain) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {v.symbol} pool <span className="text-sm font-normal text-muted-foreground">— live on Mantle ·{" "}
              <a className="text-sky-400 hover:underline" href={`${EXPLORER}/address/${v.TrancheVault}`} target="_blank" rel="noreferrer">{short(v.TrancheVault)}</a></span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!vault ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="rounded-lg border bg-card/40 px-3 py-2">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="mt-2 h-5 w-20" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-2.5 w-full rounded-full" />
                <p className="text-xs text-muted-foreground">{rpcError ? "Mantle RPC busy — retrying…" : "Reading Mantle…"}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="TVL" value={f(vault.tvl, 2)} sub={v.symbol} />
                  <Stat label="Coupon" value={`${(vault.couponBps / 100).toFixed(2)}%`} />
                  <Stat label="Senior NAV/sh" value={f(vault.seniorNav, 4)} color="text-sky-400" />
                  <Stat label="Junior NAV/sh" value={f(vault.juniorNav, 4)} color="text-violet-400" />
                </div>
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-sky-400">Senior · {f(vault.seniorAssets, 2)} {v.symbol}</span>
                    <span className="text-violet-400">Junior · {f(vault.juniorAssets, 2)} {v.symbol}</span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                    <div className="bg-sky-500" style={{ width: `${(Number(vault.seniorAssets) / Math.max(1, Number(vault.tvl))) * 100}%` }} />
                    <div className="bg-violet-500" style={{ width: `${(Number(vault.juniorAssets) / Math.max(1, Number(vault.tvl))) * 100}%` }} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{v.strategy} The agent reports net yield via <code>settle</code>; senior is protected, junior is first-loss + levered. Deposits are KYC-gated (compliance).</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Your position */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Your position</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!account ? (
              <p className="text-sm text-muted-foreground">Connect MetaMask (Mantle Sepolia) to deposit.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Stat label={`Your ${v.symbol}`} value={user ? f(user.asset, 3) : "…"} />
                  <Stat label="KYC" value={user?.kyc ? "approved" : "not approved"} color={user?.kyc ? "text-emerald-400" : "text-amber-400"} />
                  <Stat label="Senior shares" value={user ? f(user.seniorShares, 3) : "…"} color="text-sky-400" />
                  <Stat label="Junior shares" value={user ? f(user.juniorShares, 3) : "…"} color="text-violet-400" />
                </div>

                {user && !user.kyc && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <p className="mb-2 text-amber-300">Deposits require KYC/accredited approval (RWA compliance).</p>
                    <Button size="sm" variant="secondary" onClick={getKyc} disabled={busy}>Get approved (testnet)</Button>
                  </div>
                )}

                {user && user.asset < parseEther(amount || "0") && (
                  <p className="text-xs text-amber-300">
                    You hold {user ? f(user.asset, 2) : "0"} {v.symbol}. Use <b>Faucet {v.symbol}</b> in the top bar to mint test tokens first.
                  </p>
                )}

                <div className="flex gap-2">
                  <Button size="sm" variant={tranche === SENIOR ? "default" : "outline"} onClick={() => setTranche(SENIOR)}>Senior</Button>
                  <Button size="sm" variant={tranche === JUNIOR ? "default" : "outline"} onClick={() => setTranche(JUNIOR)}>Junior</Button>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amt">Amount <span className="text-muted-foreground">({v.symbol} to deposit · shares to redeem)</span></Label>
                  <div className="relative">
                    <Input id="amt" type="number" value={amount} min={0} step={0.5} onChange={(e) => setAmount(e.target.value)} className="font-mono pr-16" />
                    {user && (
                      <button
                        type="button"
                        onClick={() => setAmount(formatEther((heldShares ?? 0n) > 0n ? heldShares! : (user.asset ?? 0n)))}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md bg-violet-500/15 px-2 py-1 text-xs font-medium text-violet-300 transition hover:bg-violet-500/25"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                  {user && (heldShares ?? 0n) > 0n && (
                    <p className="text-xs text-muted-foreground">
                      You hold <b className="text-foreground">{f(heldShares!, 4)}</b> {trancheName.toLowerCase()} shares — MAX redeems all.
                      {overRedeem && <span className="text-amber-300"> Amount exceeds your shares.</span>}
                    </p>
                  )}
                </div>

                {user?.kyc && needsApproval && (
                  <p className="text-xs text-muted-foreground">
                    One-time setup: <b className="text-foreground">approve</b> the vault to use your {v.symbol} (step 1), then <b className="text-foreground">deposit</b> (step 2).
                  </p>
                )}

                <div className="flex gap-2">
                  {needsApproval ? (
                    <Button onClick={approve} disabled={busy || !user?.kyc} className="flex-1">
                      {busy ? `${busyLabel ?? "Working"}…` : `Approve ${v.symbol}`}
                    </Button>
                  ) : (
                    <Button onClick={deposit} disabled={busy || !user?.kyc || insufficient} className="flex-1">
                      {busy ? `${busyLabel ?? "Working"}…` : insufficient ? `Faucet ${v.symbol} first` : `Deposit ${trancheName}`}
                    </Button>
                  )}
                  <Button onClick={withdraw} disabled={busy || !heldShares || overRedeem} variant="secondary" className="flex-1">
                    {busy ? "…" : overRedeem ? "Too many shares" : "Redeem"}
                  </Button>
                </div>

              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* How this vault earns */}
      <section className="mt-8">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-muted-foreground">How the {v.symbol} vault earns</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <HowStep n="1" title="Deposit & tranche" body={`Deposit ${v.symbol} into a senior (protected) or junior (levered) tranche and receive ERC-20 tranche tokens. KYC-gated for compliance.`} />
          <HowStep n="2" title="Agent runs the strategy" body={v.symbol === "mETH" ? "An autonomous AI agent captures the staking yield and hedges the ETH price on Hyperliquid — delta-neutral, Ethena-style." : "An autonomous AI agent compounds the tokenized-treasury yield and manages risk across the tranche structure."} />
          <HowStep n="3" title="Settled on Mantle" body="The agent reports realized yield on-chain via settle(). Junior NAV rises with performance; senior is protected. Redeem at NAV anytime." />
        </div>
      </section>

      {/* Verified callout */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">✓</span>
          <div>
            <div className="text-sm font-medium">Verified &amp; auditable on Mantle</div>
            <div className="text-xs text-muted-foreground">Source + ABI public on Mantlescan — read the exact settlement logic or call the contracts directly.</div>
          </div>
        </div>
        <a className="text-sm text-sky-400 hover:underline" href={`https://sepolia.mantlescan.xyz/address/${v.TrancheVault}#code`} target="_blank" rel="noreferrer">View source ↗</a>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        {v.symbol} vault{" "}
        <a className="text-sky-400 hover:underline" href={`${EXPLORER}/address/${v.TrancheVault}`} target="_blank" rel="noreferrer">{short(v.TrancheVault)}</a>{" · "}
        {v.symbol} <a className="text-sky-400 hover:underline" href={`${EXPLORER}/address/${v.asset}`} target="_blank" rel="noreferrer">{short(v.asset)}</a>{" · "}
        DecisionLog <a className="text-sky-400 hover:underline" href={`${EXPLORER}/address/${v.DecisionLog}`} target="_blank" rel="noreferrer">{short(v.DecisionLog)}</a>
      </p>
      </main>
    </>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-card/40 px-4 py-3">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className={`mt-1 flex items-baseline gap-1 font-mono text-xl tabular-nums ${color ?? ""}`}>
        <span className="truncate">{value}</span>
        {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function HowStep({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-2xl border bg-card/40 p-5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 font-mono text-sm text-violet-300">{n}</div>
      <h3 className="mt-3.5 font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
