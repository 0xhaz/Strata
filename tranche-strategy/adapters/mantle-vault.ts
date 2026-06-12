/**
 * Mantle vault client — reads vault state and reports realized yield via `settle`.
 * Shared by scripts/mantle-settle.ts (CLI) and scripts/agent-loop.ts (the live agent
 * reporting yield on-chain each period). The wallet is created lazily so importing this
 * module without settling needs no key.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, fallback, defineChain, parseAbi,
  parseUnits, formatUnits, encodeFunctionData, type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const deployment = JSON.parse(
  readFileSync(new URL("../../mantle-vault/deployments/mantle-sepolia.json", import.meta.url), "utf8"),
);

export const CHAIN = defineChain({
  id: deployment.chainId,
  name: "Mantle Sepolia",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpc] } },
});

const RPCS: string[] = [deployment.rpc, "https://mantle-sepolia.drpc.org", "https://endpoints.omniatech.io/v1/mantle/sepolia/public"];

const ABI = parseAbi([
  "function settle(int256 realizedPnl)",
  "function seniorAssets() view returns (uint256)",
  "function juniorAssets() view returns (uint256)",
  "function lastSettleTs() view returns (uint64)",
  "function sharePrice(uint8) view returns (uint256)",
]);

export const pub = createPublicClient({
  chain: CHAIN,
  transport: fallback(RPCS.map((u) => http(u, { retryCount: 3, retryDelay: 400, timeout: 12_000 }))),
});

export interface VaultRef { symbol: string; decimals: number; couponBps: number; TrancheVault: Address }
export const vaultInfo = (key: string): VaultRef => {
  const v = deployment.vaults[key];
  if (!v) throw new Error(`unknown vault ${key}`);
  return v;
};
export const vaultKeys = (): string[] => Object.keys(deployment.vaults);
export const explorer = (): string => deployment.explorer;

function loadKey(): Hex {
  let k = process.env.MANTLE_AGENT_KEY;
  if (!k) {
    const env = readFileSync(new URL("../../mantle-vault/.env", import.meta.url), "utf8");
    k = env.split("\n").find((l) => l.startsWith("PRIVATE_KEY="))?.split("=")[1]?.trim();
  }
  if (!k) throw new Error("No key — set MANTLE_AGENT_KEY or mantle-vault/.env PRIVATE_KEY.");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

let _wallet: ReturnType<typeof createWalletClient> | undefined;
function wallet() {
  if (!_wallet) _wallet = createWalletClient({ account: privateKeyToAccount(loadKey()), chain: CHAIN, transport: http(deployment.rpc) });
  return _wallet;
}

export async function readVaultState(key: string) {
  const v = vaultInfo(key);
  const [seniorAssets, juniorAssets, lastSettleTs] = await Promise.all([
    pub.readContract({ address: v.TrancheVault, abi: ABI, functionName: "seniorAssets" }),
    pub.readContract({ address: v.TrancheVault, abi: ABI, functionName: "juniorAssets" }),
    pub.readContract({ address: v.TrancheVault, abi: ABI, functionName: "lastSettleTs" }),
  ]);
  return { ...v, tvl: seniorAssets + juniorAssets, seniorAssets, juniorAssets, lastSettleTs };
}

/** Period yield (in asset base units) accrued since the vault's on-chain lastSettleTs. */
export function accruedPnl(tvl: bigint, decimals: number, yieldApr: number, lastSettleTs: bigint): bigint {
  const dt = Math.max(0, Math.floor(Date.now() / 1000) - Number(lastSettleTs));
  const tvlF = Number(formatUnits(tvl, decimals));
  return parseUnits((tvlF * yieldApr * (dt / 31_536_000)).toFixed(decimals), decimals);
}

export function unsignedSettle(key: string, pnlBase: bigint) {
  const v = vaultInfo(key);
  return { to: v.TrancheVault, data: encodeFunctionData({ abi: ABI, functionName: "settle", args: [pnlBase] }), value: "0x0", chainId: deployment.chainId };
}

export interface SettleResult { hash: Hex; status: string; pnl: string; juniorNav: string }

export async function settleExact(key: string, pnlBase: bigint): Promise<SettleResult> {
  const v = vaultInfo(key);
  const hash = await wallet().writeContract({ address: v.TrancheVault, abi: ABI, functionName: "settle", args: [pnlBase], account: wallet().account!, chain: CHAIN });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  let juniorNav = "?";
  try {
    juniorNav = formatUnits(await pub.readContract({ address: v.TrancheVault, abi: ABI, functionName: "sharePrice", args: [1] }), 18);
  } catch { /* transient post-tx read race */ }
  return { hash, status: receipt.status, pnl: formatUnits(pnlBase, v.decimals), juniorNav };
}

/** Read the vault and settle the yield accrued at `yieldApr` since the last on-chain settle. */
export async function settleAccrued(key: string, yieldApr: number): Promise<SettleResult> {
  const s = await readVaultState(key);
  return settleExact(key, accruedPnl(s.tvl, s.decimals, yieldApr, s.lastSettleTs));
}
