"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  fetchPool,
  shareBalance,
  buildDepositTx,
  buildWithdrawTx,
  isConfigured,
  SENIOR,
  JUNIOR,
  type PoolView,
} from "@/lib/vault";
import { clusterLabel } from "@/lib/cluster";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

const usd = (n: number, dp = 2) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

export function VaultApp() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [pool, setPool] = useState<PoolView | null>(null);
  const [mine, setMine] = useState<{ senior: number; junior: number }>({ senior: 0, junior: 0 });
  const [tranche, setTranche] = useState<number>(SENIOR);
  const [amount, setAmount] = useState<string>("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const p = await fetchPool(connection);
    setPool(p);
    if (publicKey) {
      setMine({
        senior: await shareBalance(connection, publicKey, SENIOR),
        junior: await shareBalance(connection, publicKey, JUNIOR),
      });
    }
    setLoaded(true);
  }, [connection, publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function send(kind: "deposit" | "withdraw") {
    if (!publicKey) return;
    setBusy(true);
    setMsg(null);
    try {
      const n = Number(amount);
      const tx =
        kind === "deposit"
          ? await buildDepositTx(connection, { publicKey }, tranche, n)
          : await buildWithdrawTx(connection, { publicKey }, tranche, n);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setMsg(`${kind} confirmed · ${sig.slice(0, 8)}…`);
      await refresh();
    } catch (e) {
      setMsg(`${kind} failed: ${(e as Error).message.split("\n")[0]}`);
    } finally {
      setBusy(false);
    }
  }

  const trancheName = tranche === SENIOR ? "Senior" : "Junior";

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Tranche Vault</h1>
            <Badge variant="outline" className="border-violet-500/40 text-violet-400">pooled</Badge>
            <Badge variant="outline" className="text-muted-foreground">{clusterLabel()}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            A shared senior/junior vault on Solana. Many depositors, one pool — deposit USDC, receive tranche shares, redeem at NAV.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Operator →</Link>
          <Link href="/manage" className="text-sm text-muted-foreground hover:text-foreground">Manage →</Link>
          <WalletMultiButton style={{ backgroundColor: "var(--primary)", color: "var(--primary-foreground)", height: 36, fontSize: 13, borderRadius: 8 }} />
        </div>
      </header>

      {!isConfigured() ? (
        <NotConfigured />
      ) : !loaded ? (
        <p className="text-sm text-muted-foreground">Loading pool…</p>
      ) : !pool ? (
        <PoolNotFound />
      ) : (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* Pool stats */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="text-base">Pool</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="TVL" value={usd(pool.tvl, 0)} />
                <Stat label="Coupon" value={`${(pool.couponBps / 100).toFixed(2)}%`} />
                <Stat label="Senior NAV/share" value={pool.seniorSharePrice.toFixed(4)} color="text-sky-400" />
                <Stat label="Junior NAV/share" value={pool.juniorSharePrice.toFixed(4)} color="text-violet-400" />
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between text-sm">
                  <span className="text-sky-400">Senior · {usd(pool.seniorAssets, 0)}</span>
                  <span className="text-violet-400">Junior · {usd(pool.juniorAssets, 0)}</span>
                </div>
                <div className="flex h-2.5 w-full overflow-hidden rounded-full">
                  <div className="bg-sky-500" style={{ width: `${(pool.seniorAssets / Math.max(1, pool.tvl)) * 100}%` }} />
                  <div className="bg-violet-500" style={{ width: `${(pool.juniorAssets / Math.max(1, pool.tvl)) * 100}%` }} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                The agent runs the delta-neutral CLMM + perp strategy off-chain and reports each period&apos;s realized PnL
                via <code>settle</code>; the program applies the senior coupon and the junior first-loss buffer on-chain.
                Vault USDC always equals senior + junior assets (solvency invariant).
              </p>
            </CardContent>
          </Card>

          {/* Deposit / Withdraw */}
          <Card>
            <CardHeader><CardTitle className="text-base">Your position</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!publicKey ? (
                <p className="text-sm text-muted-foreground">Connect a wallet to deposit or redeem.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <Stat label="Your senior shares" value={mine.senior.toLocaleString()} color="text-sky-400" />
                    <Stat label="Your junior shares" value={mine.junior.toLocaleString()} color="text-violet-400" />
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant={tranche === SENIOR ? "default" : "outline"} onClick={() => setTranche(SENIOR)}>Senior</Button>
                    <Button size="sm" variant={tranche === JUNIOR ? "default" : "outline"} onClick={() => setTranche(JUNIOR)}>Junior</Button>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="amt">Amount ({trancheName})</Label>
                    <Input id="amt" type="number" value={amount} min={0} step={100} onChange={(e) => setAmount(e.target.value)} className="font-mono" />
                  </div>

                  <div className="flex gap-2">
                    <Button onClick={() => send("deposit")} disabled={busy} className="flex-1">{busy ? "…" : `Deposit ${trancheName}`}</Button>
                    <Button onClick={() => send("withdraw")} disabled={busy} variant="secondary" className="flex-1">{busy ? "…" : "Redeem"}</Button>
                  </div>

                  {msg && <p className="rounded-md border bg-card/40 p-2 text-xs text-muted-foreground">{msg}</p>}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border bg-card/40 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-mono text-base ${color ?? ""}`}>{value}</div>
    </div>
  );
}

function NotConfigured() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Vault not configured</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Set these env vars (in <code>web/.env.local</code>) to point the app at a deployed pool:</p>
        <pre className="rounded-md border bg-black/30 p-3 font-mono text-xs">{`NEXT_PUBLIC_SOLANA_RPC=http://127.0.0.1:8899
NEXT_PUBLIC_VAULT_AUTHORITY=<pool authority pubkey>
NEXT_PUBLIC_VAULT_USDC_MINT=<usdc mint>`}</pre>
        <p>The program lives in <code>tranche-vault/</code>. Build + test: <code>anchor test</code>. Deploy + init a pool, then fill these in.</p>
      </CardContent>
    </Card>
  );
}

function PoolNotFound() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">No pool on this cluster</CardTitle></CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The program is configured but no pool has been initialized for this authority on <b>{clusterLabel()}</b>.
        Run the init step (authority calls <code>initialize_pool</code>) and reload.
      </CardContent>
    </Card>
  );
}
