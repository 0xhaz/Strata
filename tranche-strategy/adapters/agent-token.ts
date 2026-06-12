/**
 * agent-token handoff — the signing / broadcast / custody + Solana→Hyperliquid
 * bridge layer (techstacks §4, architecture §12).
 *
 * ⛔ BLOCKED DEPENDENCY. This skill is NOT public — obtained via hackathon
 * onboarding (workplan Phase 0 [BLOCKER]). It is the trusted boundary every
 * fund-moving skill routes through.
 *
 * CLAUDE.md hard rule 1: we NEVER reimplement signing or key handling. Every
 * fund-moving tx is built UNSIGNED, then handed here for signing + broadcast.
 * This file is the INTERFACE only — it deliberately refuses to fake a signature.
 * When the real skill lands, implement `sign()` / `bridge()` to invoke it; do not
 * import a keypair here. If you are tempted to, STOP — you are doing it wrong.
 */

export interface UnsignedTx {
  venue: "solana" | "hyperliquid";
  description: string;
  payload: unknown; // CLI-produced unsigned tx / order intent
}

export interface SignResult {
  signature: string;
  confirmed: boolean;
}

export class AgentTokenUnavailableError extends Error {
  constructor(what: string) {
    super(
      `agent-token skill not wired (${what}). It is a hackathon-onboarding ` +
        `dependency — obtain it before any live fund movement (workplan Phase 0). ` +
        `Never substitute a local keypair (CLAUDE.md hard rule 1).`,
    );
    this.name = "AgentTokenUnavailableError";
  }
}

/** Hand an unsigned tx to agent-token for signing + broadcast. */
export async function sign(_tx: UnsignedTx): Promise<SignResult> {
  throw new AgentTokenUnavailableError("sign");
}

/** Fund the Hyperliquid account by bridging USDC from the Solana Privy wallet. */
export async function bridgeSolanaToHyperliquid(_amountUsdc: number): Promise<SignResult> {
  throw new AgentTokenUnavailableError("bridgeSolanaToHyperliquid");
}

export async function isAvailable(): Promise<boolean> {
  return false; // flip to a real probe when the skill is installed
}
