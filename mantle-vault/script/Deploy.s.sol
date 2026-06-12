// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {TrancheVault} from "../src/TrancheVault.sol";
import {TestRWA} from "../src/TestRWA.sol";
import {DecisionLog} from "../src/DecisionLog.sol";

/// Deploys an RWA tranche vault to Mantle and seeds a demo pool. Asset is env-parameterized
/// so the same script deploys the mETH vault (defaults) or a USDY vault.
///
///   # mETH (delta-neutral staked-ETH yield)
///   forge script script/Deploy.s.sol --rpc-url mantle_sepolia --broadcast
///
///   # USDY (tranched tokenized-treasury yield)
///   TOKEN_NAME="Ondo US Dollar Yield (mock)" TOKEN_SYMBOL=USDY TOKEN_DECIMALS=18 \
///   COUPON_BPS=450 SEED_SENIOR=6000000000000000000000 SEED_JUNIOR=4000000000000000000000 \
///   SEED_YIELD=150000000000000000000 \
///   forge script script/Deploy.s.sol --rpc-url mantle_sepolia --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address agent = vm.addr(pk);

        string memory name = vm.envOr("TOKEN_NAME", string("Mantle Staked ETH (mock)"));
        string memory symbol = vm.envOr("TOKEN_SYMBOL", string("mETH"));
        uint8 decimals = uint8(vm.envOr("TOKEN_DECIMALS", uint256(18)));
        uint16 coupon = uint16(vm.envOr("COUPON_BPS", uint256(287)));
        uint16 maxSettleBps = uint16(vm.envOr("MAX_SETTLE_BPS", uint256(2000))); // ≤20% of TVL per settle
        uint256 seedSenior = vm.envOr("SEED_SENIOR", uint256(6 ether));
        uint256 seedJunior = vm.envOr("SEED_JUNIOR", uint256(4 ether));
        uint256 seedYield = vm.envOr("SEED_YIELD", uint256(0.05 ether));

        vm.startBroadcast(pk);

        TestRWA rwa = new TestRWA(name, symbol, decimals);
        DecisionLog log = new DecisionLog();
        TrancheVault vault = new TrancheVault(rwa, coupon, agent, maxSettleBps);

        vault.setKyc(agent, true);
        rwa.mint(agent, seedSenior + seedJunior + seedYield + 10 ** decimals * 1000);
        rwa.approve(address(vault), type(uint256).max);
        vault.deposit(0, seedSenior); // senior
        vault.deposit(1, seedJunior); // junior
        vault.settle(int256(seedYield)); // first period's net yield → junior NAV ticks up

        vm.stopBroadcast();

        console.log("== %s vault ==", symbol);
        console.log("asset (RWA):", address(rwa));
        console.log("DecisionLog:", address(log));
        console.log("TrancheVault:", address(vault));
        console.log("seniorToken:", address(vault.seniorToken()));
        console.log("juniorToken:", address(vault.juniorToken()));
        console.log("decimals   :", decimals);
        console.log("couponBps  :", coupon);
        console.log("maxSettleBps:", maxSettleBps);
        console.log("agent/owner/settler:", agent);
    }
}
