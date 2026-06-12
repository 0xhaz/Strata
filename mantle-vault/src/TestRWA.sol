// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title TestRWA — a mock tokenized real-world-asset token for the Mantle testnet demo.
/// @notice Stands in for a yield-bearing RWA (e.g. USDY / tokenized treasuries). Open faucet
///         so demo wallets can mint and deposit. On mainnet the vault would point at the
///         canonical RWA token instead.
contract TestRWA is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// Open faucet (testnet only).
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
