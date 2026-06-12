/**
 * Testnet KYC auto-approve. The vault gates deposits behind a KYC/accredited allowlist
 * (compliance). For the demo, the agent (vault owner) auto-approves a connecting wallet —
 * standing in for an AI-assisted KYC/compliance check. Owner key from mantle-vault/.env.
 */
import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWalletClient, createPublicClient, http, defineChain, parseAbi, isAddress, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployment from "@/data/mantle-deployment.json";

const chain = defineChain({
  id: deployment.chainId,
  name: "Mantle Sepolia",
  nativeCurrency: { name: "MNT", symbol: "MNT", decimals: 18 },
  rpcUrls: { default: { http: [deployment.rpc] } },
});

const ABI = parseAbi([
  "function setKyc(address user, bool approved)",
  "function kycApproved(address) view returns (bool)",
]);

function ownerKey(): Hex {
  let k = process.env.MANTLE_AGENT_KEY;
  if (!k) {
    const env = readFileSync(join(process.cwd(), "..", "mantle-vault", ".env"), "utf8");
    k = env.split("\n").find((l) => l.startsWith("PRIVATE_KEY="))?.split("=")[1]?.trim();
  }
  if (!k) throw new Error("owner key unavailable");
  return (k.startsWith("0x") ? k : `0x${k}`) as Hex;
}

export async function POST(req: Request) {
  try {
    const { address, vaultKey } = (await req.json()) as { address?: string; vaultKey?: string };
    if (!address || !isAddress(address)) {
      return NextResponse.json({ ok: false, error: "valid address required" }, { status: 400 });
    }
    const vaults = deployment.vaults as Record<string, { TrancheVault: string }>;
    const v = vaults[vaultKey ?? "mETH"];
    if (!v) return NextResponse.json({ ok: false, error: "unknown vault" }, { status: 400 });
    const vault = v.TrancheVault as Address;
    const pub = createPublicClient({ chain, transport: http() });
    if (await pub.readContract({ address: vault, abi: ABI, functionName: "kycApproved", args: [address] })) {
      return NextResponse.json({ ok: true, alreadyApproved: true });
    }
    const account = privateKeyToAccount(ownerKey());
    const wallet = createWalletClient({ account, chain, transport: http() });
    const hash = await wallet.writeContract({ address: vault, abi: ABI, functionName: "setKyc", args: [address, true] });
    await pub.waitForTransactionReceipt({ hash });
    return NextResponse.json({ ok: true, txHash: hash });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
