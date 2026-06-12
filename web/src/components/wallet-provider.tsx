"use client";

import { useMemo, type ReactNode } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { RPC_ENDPOINT } from "@/lib/cluster";

/**
 * Solana wallet context. Endpoint is configurable via NEXT_PUBLIC_SOLANA_RPC and
 * defaults to DEVNET (testnet-only per CLAUDE.md rule 4); set it to
 * http://127.0.0.1:8899 to talk to a local validator. Wallets auto-detect via the
 * Wallet Standard (Phantom, Solflare, Backpack…). The operator connects their OWN
 * wallet — single-user capital, never pooled.
 */
export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC_ENDPOINT ?? clusterApiUrl("devnet"), []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
