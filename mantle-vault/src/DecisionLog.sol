// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title DecisionLog — append-only on-chain journal for the Tranche Agent.
/// @notice Original code for this submission (NOT lifted from BarnBridge — architecture §14
///         explicitly sanctions a self-authored Mantle event emitter as the logging path).
///         The agent emits one event per wake-cycle decision; the immutable log IS the
///         verifiable track record (Track A / V-04). Events are cheap and queryable.
/// @dev    No funds are held or moved. This contract only emits events. Ties each decision
///         to the agent's ERC-8004 `agentId` for a verifiable identity → track-record link.
contract DecisionLog {
    /// @param agentId   ERC-8004 identity of the emitting agent
    /// @param ts        agent-side decision timestamp (unix seconds)
    /// @param action    keccak-friendly short string: "rebalance" | "hold" | "re-range" | "skip-stale"
    /// @param priceE6   SOL/USDC price, fixed-point 1e6
    /// @param targetShortE6  target short size (SOL), fixed-point 1e6
    /// @param currentShortE6 held short size (SOL), fixed-point 1e6
    /// @param driftBps  drift vs target, in basis points
    /// @param fundingBps annualized funding, in basis points (signed)
    /// @param reason    human-readable rationale (kept short)
    event Decision(
        uint256 indexed agentId,
        uint64 indexed ts,
        string action,
        int256 priceE6,
        int256 targetShortE6,
        int256 currentShortE6,
        int32 driftBps,
        int32 fundingBps,
        string reason
    );

    /// @notice Append one decision to the journal. Caller is the agent's operator wallet
    ///         (or a relayer); the contract is permissionless by design — anyone can write
    ///         their own log, indexed by their own agentId. No access control needed because
    ///         it holds nothing and the verifiable claim is "this agentId emitted this".
    function logDecision(
        uint256 agentId,
        uint64 ts,
        string calldata action,
        int256 priceE6,
        int256 targetShortE6,
        int256 currentShortE6,
        int32 driftBps,
        int32 fundingBps,
        string calldata reason
    ) external {
        emit Decision(agentId, ts, action, priceE6, targetShortE6, currentShortE6, driftBps, fundingBps, reason);
    }
}
