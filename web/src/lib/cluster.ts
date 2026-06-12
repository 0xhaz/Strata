/**
 * Cluster + vault configuration, env-driven so the same build works on localnet
 * (developer validator) or devnet (deployed). All NEXT_PUBLIC_* so they reach the client.
 *
 *   NEXT_PUBLIC_SOLANA_RPC        RPC URL (default: devnet)
 *   NEXT_PUBLIC_VAULT_AUTHORITY   pool authority pubkey (derives the pool PDA)
 *   NEXT_PUBLIC_VAULT_USDC_MINT   USDC (or test-USDC) mint the vault accepts
 */
import { clusterApiUrl } from "@solana/web3.js";

export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC && process.env.NEXT_PUBLIC_SOLANA_RPC.length > 0
    ? process.env.NEXT_PUBLIC_SOLANA_RPC
    : clusterApiUrl("devnet");

export const VAULT_AUTHORITY = process.env.NEXT_PUBLIC_VAULT_AUTHORITY ?? "";
export const VAULT_USDC_MINT = process.env.NEXT_PUBLIC_VAULT_USDC_MINT ?? "";

export const clusterLabel = () => {
  if (RPC_ENDPOINT.includes("127.0.0.1") || RPC_ENDPOINT.includes("localhost")) return "localnet";
  if (RPC_ENDPOINT.includes("devnet")) return "devnet";
  if (RPC_ENDPOINT.includes("mainnet")) return "mainnet";
  return "custom";
};
