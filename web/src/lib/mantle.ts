/**
 * Mantle Sepolia client for the live RWA tranche vaults (mETH + USDY). Reads via a public
 * RPC client; writes via the user's injected EVM wallet (window.ethereum / MetaMask).
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  fallback,
  defineChain,
  parseAbi,
  type Address,
} from "viem";
import deployment from "@/data/mantle-deployment.json";

// The public Mantle Sepolia RPC is flaky under load — retry + fall back across endpoints.
const RPCS = [deployment.rpc, "https://mantle-sepolia.drpc.org", "https://endpoints.omniatech.io/v1/mantle/sepolia/public"];

export const MANTLE = defineChain({
  id: deployment.chainId,
  name: "Mantle Sepolia",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpc] } },
  blockExplorers: { default: { name: "Mantle Sepolia Explorer", url: deployment.explorer } },
});

export interface VaultInfo {
  symbol: string;
  decimals: number;
  couponBps: number;
  strategy: string;
  TrancheVault: Address;
  asset: Address;
  DecisionLog: Address;
  seniorToken: Address;
  juniorToken: Address;
}

export const VAULTS = deployment.vaults as Record<string, VaultInfo>;
export const VAULT_KEYS = Object.keys(VAULTS);
export const EXPLORER = deployment.explorer;
export const SENIOR = 0;
export const JUNIOR = 1;

export const VAULT_ABI = parseAbi([
  "function tvl() view returns (uint256)",
  "function seniorAssets() view returns (uint256)",
  "function juniorAssets() view returns (uint256)",
  "function couponBps() view returns (uint16)",
  "function paused() view returns (bool)",
  "function kycApproved(address) view returns (bool)",
  "function sharePrice(uint8) view returns (uint256)",
  "function deposit(uint8 tranche, uint256 amount)",
  "function withdraw(uint8 tranche, uint256 shares)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function mint(address to, uint256 amount)",
]);

export const publicClient = createPublicClient({
  chain: MANTLE,
  transport: fallback(RPCS.map((url) => http(url, { retryCount: 3, retryDelay: 400, timeout: 12_000 }))),
});

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export function hasInjected(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) throw new Error("No EVM wallet found (install MetaMask).");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
  const hexId = `0x${MANTLE.id.toString(16)}`;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch {
    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexId,
        chainName: MANTLE.name,
        nativeCurrency: MANTLE.nativeCurrency,
        rpcUrls: [deployment.rpc],
        blockExplorerUrls: [deployment.explorer],
      }],
    });
  }
  return accounts[0];
}

export function walletClient(account: Address) {
  return createWalletClient({ account, chain: MANTLE, transport: custom(window.ethereum!) });
}

export interface VaultState {
  tvl: bigint;
  seniorAssets: bigint;
  juniorAssets: bigint;
  couponBps: number;
  paused: boolean;
  seniorNav: bigint;
  juniorNav: bigint;
}

export async function readVault(v: VaultInfo): Promise<VaultState> {
  const c = { address: v.TrancheVault, abi: VAULT_ABI } as const;
  const [tvl, seniorAssets, juniorAssets, couponBps, paused, seniorNav, juniorNav] = await Promise.all([
    publicClient.readContract({ ...c, functionName: "tvl" }),
    publicClient.readContract({ ...c, functionName: "seniorAssets" }),
    publicClient.readContract({ ...c, functionName: "juniorAssets" }),
    publicClient.readContract({ ...c, functionName: "couponBps" }),
    publicClient.readContract({ ...c, functionName: "paused" }),
    publicClient.readContract({ ...c, functionName: "sharePrice", args: [SENIOR] }),
    publicClient.readContract({ ...c, functionName: "sharePrice", args: [JUNIOR] }),
  ]);
  return { tvl, seniorAssets, juniorAssets, couponBps, paused, seniorNav, juniorNav };
}

export interface UserState {
  asset: bigint;
  seniorShares: bigint;
  juniorShares: bigint;
  kyc: boolean;
  allowance: bigint;
}

export async function readUser(addr: Address, v: VaultInfo): Promise<UserState> {
  const [asset, seniorShares, juniorShares, kyc, allowance] = await Promise.all([
    publicClient.readContract({ address: v.asset, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: v.seniorToken, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: v.juniorToken, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: v.TrancheVault, abi: VAULT_ABI, functionName: "kycApproved", args: [addr] }),
    publicClient.readContract({ address: v.asset, abi: ERC20_ABI, functionName: "allowance", args: [addr, v.TrancheVault] }),
  ]);
  return { asset, seniorShares, juniorShares, kyc, allowance };
}
