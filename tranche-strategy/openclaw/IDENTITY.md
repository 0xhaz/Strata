# IDENTITY.md — agent identity (ERC-8004)

> The agent's on-chain identity. ERC-8004 "Trustless Agents" went live Jan 29, 2026
> (architecture §14). Identity = an ERC-721 NFT in the Identity Registry whose
> `tokenURI` points at an Agent Registration File (JSON, hosted on IPFS/HTTPS).

## What we mint

- An **agent identity NFT** via `IdentityRegistry.register()` → assigns an `agentId`
  and mints the NFT to the operator wallet. One-time, low-risk, canonical contract.
- `tokenURI` → `openclaw/agent-registration.json` (name, capabilities, endpoints),
  hosted at a stable URL.

## Why it matters

It ties the on-chain decision log (every rebalance + rationale) to a stable,
verifiable agent identity — the Track-A "verifiable track record" criterion (V-04).
Reputation/validation registries can later reference this `agentId`.

## Status

- Mint script: `scripts/mint-identity.ts` (canonical ABI, address-configurable).
- ⛔ **Blocked on the Mantle ERC-8004 Identity Registry address** (hackathon docs).
  Set `MANTLE_RPC_URL` + `ERC8004_IDENTITY_REGISTRY` env, then run the mint. The script
  builds the call and routes signing through the agent-token handoff — it does NOT
  hold a key.
- Once minted, record `agentId` + `mantleTxHash` here and in `config/state.json`.

```
agentId:        <unset — pending mint>
identityNft:    <unset>
registry:       <unset — Mantle ERC-8004 IdentityRegistry address>
registrationUri: ipfs://<unset>  (see agent-registration.json)
```
