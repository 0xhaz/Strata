#!/usr/bin/env bash
# Verify all Strata contracts on Mantle Sepolia via the Etherscan V2 API.
#
#   ETHERSCAN_API_KEY=<your key> ./verify.sh
#
# Get a free key at https://etherscan.io/apidashboard (one key works for all chains, incl. Mantle).
# (Mantle's Blockscout explorer API is currently flaky; Etherscan V2 is the reliable verifier.)
set -euo pipefail

: "${ETHERSCAN_API_KEY:?Set ETHERSCAN_API_KEY (free at https://etherscan.io/apidashboard)}"
CHAIN=5003
AGENT=0x0E128580d848fB51849ab6564467A9BA79B4820c

v() { # v <address> <path:Contract> [constructor-args-encoded]
  echo "→ verifying $2  @ $1"
  forge verify-contract "$1" "$2" \
    --chain "$CHAIN" --etherscan-api-key "$ETHERSCAN_API_KEY" \
    ${3:+--constructor-args "$3"} --watch || echo "  (verify failed/skipped — may already be verified)"
}

# ── mETH vault ──
METH=0x83130374d16D5d1d95dB1ABE38cebF3F61c88329
METH_VAULT=0x7dF879Ff39AC3bAC696A38Da05aa19b51f9D1818
v "$METH" src/TestRWA.sol:TestRWA "$(cast abi-encode 'c(string,string,uint8)' 'Mantle Staked ETH (mock)' 'mETH' 18)"
v "$METH_VAULT" src/TrancheVault.sol:TrancheVault "$(cast abi-encode 'c(address,uint16,address,uint16)' "$METH" 287 "$AGENT" 2000)"
v 0xeDA923bA147e6CDE088399De10B2152AeB51e2c2 src/TrancheToken.sol:TrancheToken "$(cast abi-encode 'c(string,string,uint8,address)' 'Tranche Senior' 'trSR' 18 "$METH_VAULT")"
v 0x42935Cd68ceCff9cC6De318C3E303464B808648E src/TrancheToken.sol:TrancheToken "$(cast abi-encode 'c(string,string,uint8,address)' 'Tranche Junior' 'trJR' 18 "$METH_VAULT")"
v 0x0f64Cb12512667BBcFDE913048fA68051e632abE src/DecisionLog.sol:DecisionLog

# ── USDY vault ──
USDY=0x9d3824f42dFF56D530Bfedd849c21CCc5b7128f5
USDY_VAULT=0x5BD8C01c04fbceB769B82b13d6A879a1081f75d1
v "$USDY" src/TestRWA.sol:TestRWA "$(cast abi-encode 'c(string,string,uint8)' 'Ondo US Dollar Yield (mock)' 'USDY' 18)"
v "$USDY_VAULT" src/TrancheVault.sol:TrancheVault "$(cast abi-encode 'c(address,uint16,address,uint16)' "$USDY" 450 "$AGENT" 2000)"
v 0xeDdAC58af69925A8C78c1b7C75568b3b6C7153a6 src/TrancheToken.sol:TrancheToken "$(cast abi-encode 'c(string,string,uint8,address)' 'Tranche Senior' 'trSR' 18 "$USDY_VAULT")"
v 0xea25aC784F269b63791840ff61Cb66Eb554D3b97 src/TrancheToken.sol:TrancheToken "$(cast abi-encode 'c(string,string,uint8,address)' 'Tranche Junior' 'trJR' 18 "$USDY_VAULT")"
v 0xE71600e749bB899E7768ddfc962B70663dF3c9E0 src/DecisionLog.sol:DecisionLog

echo "Done. Check https://sepolia.mantlescan.xyz/address/$METH_VAULT#code"
echo "      and    https://sepolia.mantlescan.xyz/address/$USDY_VAULT#code"
