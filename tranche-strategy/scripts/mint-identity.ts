/**
 * Mint the ERC-8004 agent identity NFT (architecture §14). Builds the
 * IdentityRegistry.register() call as an UNSIGNED tx and emits it for the
 * agent-token signing handoff — we never hold a key (CLAUDE.md rule 1).
 *
 *   ERC8004_IDENTITY_REGISTRY=0x... MANTLE_CHAIN_ID=5003 \
 *     tsx scripts/mint-identity.ts --uri ipfs://<registration-json-cid> [-o json]
 *
 * The Mantle ERC-8004 IdentityRegistry address is an onboarding dependency; the ABI
 * below is the canonical `register(string tokenURI) → agentId` shape. If the deployed
 * registry uses a different signature, adjust the ABI to match (it is the only
 * registry-specific piece).
 */
import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { parseArgs, emit } from "./io.js";

const IDENTITY_REGISTRY_ABI = parseAbi([
  "function register(string tokenURI) returns (uint256 agentId)",
]);

const argv = parseArgs();
const uri = String(argv.flags.uri ?? "");
const registry = process.env.ERC8004_IDENTITY_REGISTRY;
const chainId = process.env.MANTLE_CHAIN_ID ? Number(process.env.MANTLE_CHAIN_ID) : undefined;

if (!uri) throw new Error("Missing --uri (the agent-registration.json IPFS/HTTPS URL).");

const data = encodeFunctionData({
  abi: IDENTITY_REGISTRY_ABI,
  functionName: "register",
  args: [uri],
});

const blocked = !registry || chainId === undefined;
const unsignedTx = {
  to: (registry ?? "0x0000000000000000000000000000000000000000") as Hex,
  data,
  value: "0x0",
  chainId: chainId ?? null,
};

emit(
  argv,
  {
    ok: !blocked,
    blocked,
    reason: blocked
      ? "Set ERC8004_IDENTITY_REGISTRY + MANTLE_CHAIN_ID (Mantle onboarding dep). Calldata is built regardless."
      : "Unsigned register() tx built — hand to agent-token for signing + broadcast.",
    unsignedTx,
    registrationUri: uri,
  },
  () => {
    console.log(blocked ? "[blocked] registry/chain not set — calldata built for inspection:" : "Unsigned ERC-8004 register() tx (hand to agent-token):");
    console.log(`  to:      ${unsignedTx.to}`);
    console.log(`  chainId: ${unsignedTx.chainId ?? "<unset>"}`);
    console.log(`  data:    ${data.slice(0, 74)}…`);
    console.log(`  tokenURI:${uri}`);
  },
);
