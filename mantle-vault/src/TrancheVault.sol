// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TrancheToken} from "./TrancheToken.sol";

/// @title TrancheVault — a pooled senior/junior yield layer for a Mantle RWA (e.g. mETH / USDY).
/// @notice A yield layer for otherwise-idle Mantle RWAs. Depositors put a yield-bearing RWA
///         (e.g. mETH — Mantle staked ETH) into a SENIOR (protected, fixed-ish coupon) or
///         JUNIOR (levered residual, first-loss) tranche and receive ERC-20 tranche tokens.
///         An off-chain AI agent runs a DELTA-NEUTRAL strategy (capture the mETH staking yield,
///         hedge the ETH price on Hyperliquid — Ethena-style) and reports the net realized
///         yield via `settle`; the vault applies the senior coupon + junior first-loss buffer
///         ON-CHAIN. Mantle is the settlement layer; the strategy executes off-chain.
///
/// Original Solidity (the senior/junior mechanism is conceptually inspired by structured-credit
/// tranching; no third-party code lifted). Mirrors the audited-by-tests Solana version.
///
/// Solvency invariant: asset.balanceOf(vault) == seniorAssets + juniorAssets.
/// Compliance: deposits are gated by a KYC/accredited allowlist; withdrawals always open.
contract TrancheVault is Ownable {
    using SafeERC20 for IERC20Metadata;

    uint256 private constant SECONDS_PER_YEAR = 31_536_000;
    uint256 private constant BPS_DENOM = 10_000;
    uint16 private constant COUPON_BPS_MAX = 1_200; // 12% hard cap

    uint8 public constant SENIOR = 0;
    uint8 public constant JUNIOR = 1;

    IERC20Metadata public immutable asset; // the tokenized RWA deposit token
    TrancheToken public immutable seniorToken;
    TrancheToken public immutable juniorToken;
    uint16 public couponBps;

    uint256 public seniorAssets; // RWA value claimable by senior (shares = seniorToken.totalSupply())
    uint256 public juniorAssets;
    uint64 public lastSettleTs;
    bool public paused;

    // ── Trust-minimization (see settle) ──
    // `settler` is the (hot) strategy/agent key allowed to report PnL; `owner` is the cold admin
    // (pause / KYC / role rotation). Splitting them caps the blast radius of an agent-key leak.
    address public settler;
    // A single settle can move at most `maxSettleBps` of TVL — an anti-rug rate-limit that also
    // self-polices the off-chain AI's reported number. Production trends this DOWN (+ multisig owner).
    uint16 public maxSettleBps;

    mapping(address => bool) public kycApproved; // compliance gate for deposits

    event Deposit(address indexed user, uint8 indexed tranche, uint256 amount, uint256 shares);
    event Withdraw(address indexed user, uint8 indexed tranche, uint256 amount, uint256 shares);
    event Settled(int256 realizedPnl, uint256 coupon, uint256 seniorAssets, uint256 juniorAssets, bool bufferBreached);
    event PausedSet(bool paused);
    event KycSet(address indexed user, bool approved);
    event SettlerSet(address indexed settler);
    event MaxSettleBpsSet(uint16 bps);

    error CouponTooHigh();
    error ZeroAmount();
    error ZeroShares();
    error BadTranche();
    error PausedError();
    error NotKyc();
    error Insolvent();
    error InsufficientVault();
    error NotSettler();
    error SettleTooLarge();

    constructor(IERC20Metadata asset_, uint16 couponBps_, address admin, uint16 maxSettleBps_) Ownable(admin) {
        if (couponBps_ > COUPON_BPS_MAX) revert CouponTooHigh();
        if (maxSettleBps_ > BPS_DENOM) revert SettleTooLarge();
        asset = asset_;
        couponBps = couponBps_;
        settler = admin; // production rotates this to the agent hot key via setSettler; owner stays cold
        maxSettleBps = maxSettleBps_;
        uint8 dec = asset_.decimals();
        seniorToken = new TrancheToken("Tranche Senior", "trSR", dec, address(this));
        juniorToken = new TrancheToken("Tranche Junior", "trJR", dec, address(this));
        lastSettleTs = uint64(block.timestamp);
        emit SettlerSet(admin);
        emit MaxSettleBpsSet(maxSettleBps_);
    }

    modifier onlySettler() {
        if (msg.sender != settler) revert NotSettler();
        _;
    }

    /// Rotate the settler — the strategy/agent key allowed to report PnL. Owner stays the cold admin,
    /// so a leaked agent key can (at most) settle within the maxSettleBps band, not de-KYC or pause.
    function setSettler(address settler_) external onlyOwner {
        settler = settler_;
        emit SettlerSet(settler_);
    }

    /// Tighten/loosen the per-settle PnL cap (fraction of TVL). Owner-only; production trends it DOWN.
    function setMaxSettleBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOM) revert SettleTooLarge();
        maxSettleBps = bps;
        emit MaxSettleBpsSet(bps);
    }

    // ── Compliance (KYC / accredited allowlist) ──
    function setKyc(address user, bool approved) external onlyOwner {
        kycApproved[user] = approved;
        emit KycSet(user, approved);
    }

    function setKycBatch(address[] calldata users, bool approved) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            kycApproved[users[i]] = approved;
            emit KycSet(users[i], approved);
        }
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    // ── Deposit / withdraw / settle ──

    function _trancheToken(uint8 tranche) internal view returns (TrancheToken) {
        if (tranche == SENIOR) return seniorToken;
        if (tranche == JUNIOR) return juniorToken;
        revert BadTranche();
    }

    /// Deposit `amount` of the RWA into a tranche; mint shares at the current share price.
    function deposit(uint8 tranche, uint256 amount) external {
        if (paused) revert PausedError();
        if (!kycApproved[msg.sender]) revert NotKyc();
        if (amount == 0) revert ZeroAmount();
        TrancheToken token = _trancheToken(tranche);

        uint256 assets = tranche == SENIOR ? seniorAssets : juniorAssets;
        uint256 shares = token.totalSupply();
        uint256 minted = (shares == 0 || assets == 0) ? amount : (amount * shares) / assets;
        if (minted == 0) revert ZeroShares();

        asset.safeTransferFrom(msg.sender, address(this), amount);
        token.mint(msg.sender, minted);
        if (tranche == SENIOR) seniorAssets += amount;
        else juniorAssets += amount;

        emit Deposit(msg.sender, tranche, amount, minted);
    }

    /// Authority-only: report the period's realized strategy PnL and apply the senior coupon
    /// + junior buffer flow. PnL is moved in/out so the solvency invariant holds.
    function settle(int256 realizedPnl) external onlySettler {
        if (paused) revert PausedError();
        uint256 dt = block.timestamp - lastSettleTs;

        // Anti-rug rate-limit: |PnL| per settle is capped at maxSettleBps of TVL. Bounds the blast
        // radius of a compromised settler key and stops a single tx from draining the vault.
        uint256 mag = realizedPnl >= 0 ? uint256(realizedPnl) : uint256(-realizedPnl);
        if (mag > ((seniorAssets + juniorAssets) * maxSettleBps) / BPS_DENOM) revert SettleTooLarge();

        uint256 seniorShares = seniorToken.totalSupply();
        uint256 coupon = seniorShares > 0
            ? (seniorAssets * couponBps * dt) / (BPS_DENOM * SECONDS_PER_YEAR)
            : 0;

        // Back the realized PnL with actual RWA from the settler (the strategy account): in if
        // positive, out if negative — so the solvency invariant always holds.
        if (realizedPnl > 0) {
            asset.safeTransferFrom(settler, address(this), uint256(realizedPnl));
        } else if (realizedPnl < 0) {
            asset.safeTransfer(settler, uint256(-realizedPnl));
        }

        // Apply, preserving solvency. A tranche's residual only accrues to it if it has
        // holders (orphan-safe); junior is first-loss, senior absorbs the remainder (breach-safe).
        bool hasJunior = juniorToken.totalSupply() > 0;
        int256 juniorNew = int256(juniorAssets) + realizedPnl - int256(coupon);

        bool breached = false;
        if (hasJunior && juniorNew >= 0) {
            seniorAssets += coupon;
            juniorAssets = uint256(juniorNew);
        } else {
            int256 seniorAfter = int256(seniorAssets) + int256(juniorAssets) + realizedPnl;
            if (seniorAfter < 0) revert Insolvent();
            seniorAssets = uint256(seniorAfter);
            juniorAssets = 0;
            breached = hasJunior;
        }

        lastSettleTs = uint64(block.timestamp);
        emit Settled(realizedPnl, coupon, seniorAssets, juniorAssets, breached);
    }

    /// Redeem `shares` of a tranche for the RWA at the current share price. Always open.
    function withdraw(uint8 tranche, uint256 shares) external {
        if (shares == 0) revert ZeroShares();
        TrancheToken token = _trancheToken(tranche);
        uint256 assets = tranche == SENIOR ? seniorAssets : juniorAssets;
        uint256 totalShares = token.totalSupply();

        uint256 amountOut = (shares * assets) / totalShares;
        if (amountOut > asset.balanceOf(address(this))) revert InsufficientVault();

        token.burn(msg.sender, shares); // reverts if msg.sender lacks the shares
        if (tranche == SENIOR) seniorAssets -= amountOut;
        else juniorAssets -= amountOut;
        asset.safeTransfer(msg.sender, amountOut);

        emit Withdraw(msg.sender, tranche, amountOut, shares);
    }

    // ── Views ──
    function tvl() external view returns (uint256) {
        return seniorAssets + juniorAssets;
    }

    /// Share price in 1e18 fixed point (assets per share). 1e18 when a tranche is empty.
    function sharePrice(uint8 tranche) external view returns (uint256) {
        TrancheToken token = _trancheToken(tranche);
        uint256 shares = token.totalSupply();
        uint256 assets = tranche == SENIOR ? seniorAssets : juniorAssets;
        if (shares == 0) return 1e18;
        return (assets * 1e18) / shares;
    }
}
