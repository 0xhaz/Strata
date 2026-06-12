// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TrancheVault} from "../src/TrancheVault.sol";
import {TestRWA} from "../src/TestRWA.sol";

contract TrancheVaultTest is Test {
    TrancheVault vault;
    TestRWA rwa;
    address alice = makeAddr("alice"); // senior depositor
    address bob = makeAddr("bob"); // junior depositor
    address carol = makeAddr("carol"); // not KYC'd

    uint8 constant SENIOR = 0;
    uint8 constant JUNIOR = 1;

    function usdc(uint256 n) internal pure returns (uint256) {
        return n * 1e6;
    }

    function setUp() public {
        rwa = new TestRWA("Test USDY", "tUSDY", 6); // tokenized RWA
        // 2.87% coupon, this = admin+settler, 50% per-settle cap (permissive so the breach tests
        // can wipe junior in one settle; production deploys ~20%).
        vault = new TrancheVault(rwa, 287, address(this), 5000);

        // KYC the participants (compliance gate).
        vault.setKyc(alice, true);
        vault.setKyc(bob, true);

        // Fund authority (for settle backing) + users, and approve.
        rwa.mint(address(this), usdc(100000));
        rwa.approve(address(vault), type(uint256).max);
        for (uint256 i; i < 2; i++) {
            address u = i == 0 ? alice : bob;
            rwa.mint(u, usdc(20000));
            vm.prank(u);
            rwa.approve(address(vault), type(uint256).max);
        }
    }

    function depositAs(address u, uint8 tranche, uint256 amt) internal {
        vm.prank(u);
        vault.deposit(tranche, amt);
    }

    function assertSolvent() internal view {
        assertEq(rwa.balanceOf(address(vault)), vault.seniorAssets() + vault.juniorAssets(), "solvency");
    }

    function test_DepositBootstrapAndSolvency() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000));
        assertEq(vault.seniorAssets(), usdc(6000));
        assertEq(vault.juniorAssets(), usdc(4000));
        assertEq(vault.seniorToken().totalSupply(), usdc(6000)); // 1:1 bootstrap
        assertEq(vault.seniorToken().balanceOf(alice), usdc(6000));
        assertSolvent();
    }

    function test_SettlePositive_JuniorTakesResidual() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000));
        vault.settle(int256(usdc(200)));
        // coupon over dt=0 is 0, so junior gains the full 200.
        assertEq(vault.juniorAssets(), usdc(4200));
        assertEq(vault.seniorAssets(), usdc(6000));
        assertSolvent();
    }

    function test_RevertWhen_NonSettlerSettles() public {
        depositAs(alice, SENIOR, usdc(6000));
        vm.prank(alice);
        vm.expectRevert(TrancheVault.NotSettler.selector);
        vault.settle(int256(usdc(100)));
    }

    function test_RevertWhen_SettleExceedsCap() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000)); // TVL 10000, cap 50% = 5000
        vm.expectRevert(TrancheVault.SettleTooLarge.selector);
        vault.settle(-int256(usdc(6000))); // 60% of TVL > cap
    }

    function test_SettlerRotation_OwnerStaysAdmin() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000));

        // Rotate settling rights to bob (the "agent" key); fund + approve him to back PnL.
        vault.setSettler(bob);
        // The old admin (this) can no longer settle…
        vm.expectRevert(TrancheVault.NotSettler.selector);
        vault.settle(int256(usdc(100)));
        // …but still holds admin powers (pause/KYC).
        vault.setPaused(true);
        vault.setPaused(false);
        // The new settler can report PnL (backs it from bob's balance).
        vm.prank(bob);
        vault.settle(int256(usdc(100)));
        assertEq(vault.juniorAssets(), usdc(4100));
        assertSolvent();
    }

    function test_RevertWhen_OverWithdraw() public {
        depositAs(alice, SENIOR, usdc(6000));
        vm.prank(alice);
        vm.expectRevert(); // ERC20 burn exceeds balance
        vault.withdraw(SENIOR, usdc(7000));
    }

    function test_Pause_BlocksDepositThenRestores() public {
        vault.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(TrancheVault.PausedError.selector);
        vault.deposit(SENIOR, usdc(100));

        vault.setPaused(false);
        depositAs(alice, SENIOR, usdc(100));
        assertEq(vault.seniorAssets(), usdc(100));
        assertSolvent();
    }

    function test_BufferBreach_SeniorAbsorbsRemainder() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000));
        vault.settle(int256(usdc(200))); // junior → 4200
        // Loss of 4300 exceeds junior (4200): junior wiped, senior eats the extra 100.
        vault.settle(-int256(usdc(4300)));
        assertEq(vault.juniorAssets(), 0, "junior wiped");
        assertEq(vault.seniorAssets(), usdc(5900), "senior absorbed 100 loss");
        assertSolvent();
    }

    function test_PostBreach_JuniorRedeemsNearZero() public {
        depositAs(alice, SENIOR, usdc(6000));
        depositAs(bob, JUNIOR, usdc(4000));
        vault.settle(-int256(usdc(4500))); // wipes junior, senior absorbs 500
        assertEq(vault.juniorAssets(), 0);
        uint256 before = rwa.balanceOf(bob);
        uint256 jShares = vault.juniorToken().totalSupply(); // read BEFORE prank (arg eval consumes it)
        vm.prank(bob);
        vault.withdraw(JUNIOR, jShares);
        assertEq(rwa.balanceOf(bob) - before, 0, "junior took the loss -> ~0 out");
        assertSolvent();
    }

    function test_OrphanSafe_GainRoutesToSeniorWhenNoJunior() public {
        depositAs(alice, SENIOR, usdc(6000)); // no junior holders
        uint256 seniorBefore = vault.seniorAssets();
        vault.settle(int256(usdc(150)));
        assertEq(vault.juniorAssets(), 0, "nothing stranded in junior");
        assertEq(vault.seniorAssets(), seniorBefore + usdc(150), "senior received the gain");
        assertSolvent();
    }

    function test_Compliance_NonKycCannotDeposit() public {
        rwa.mint(carol, usdc(1000));
        vm.startPrank(carol);
        rwa.approve(address(vault), type(uint256).max);
        vm.expectRevert(TrancheVault.NotKyc.selector);
        vault.deposit(SENIOR, usdc(500));
        vm.stopPrank();

        // After KYC approval the same deposit succeeds.
        vault.setKyc(carol, true);
        depositAs(carol, SENIOR, usdc(500));
        assertEq(vault.seniorAssets(), usdc(500));
    }
}
