// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {NacrePayout} from "../src/NacrePayout.sol";

contract NacrePayoutTest is Test {
    NacrePayout internal payout;

    function setUp() public {
        payout = new NacrePayout();
    }

    function testPaysTheMeasuredShortfall() public view {
        assertEq(payout.calculatePayout(1_000, 600, 500), 400);
    }

    function testPaysNothingWhenFeesReachTheFloor() public view {
        assertEq(payout.calculatePayout(1_000, 1_000, 500), 0);
        assertEq(payout.calculatePayout(1_000, 1_200, 500), 0);
    }

    function testCapsThePayoutAtLockedCollateral() public view {
        assertEq(payout.calculatePayout(1_000, 300, 500), 500);
    }

    function testZeroCapCannotPay() public view {
        assertEq(payout.calculatePayout(1_000, 0, 0), 0);
    }

    function testFuzzPayoutNeverExceedsCap(uint256 feeFloor, uint256 eligibleFees, uint256 payoutCap) public view {
        uint256 amount = payout.calculatePayout(feeFloor, eligibleFees, payoutCap);
        assertLe(amount, payoutCap);
        assertLe(amount, feeFloor);
        if (eligibleFees >= feeFloor) assertEq(amount, 0);
    }
}
