// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {NacreFlowTest} from "./NacreFlow.t.sol";
import {NacreRangeOffer, NacreRangeOfferFactory} from "../src/NacreRangeOffers.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";

contract NacreRangeOffersTest is NacreFlowTest {
    NacreRangeOfferFactory internal factory;
    function setUp() public override {
        super.setUp();
        factory = new NacreRangeOfferFactory(app, PoolId.unwrap(PoolIdLibrary.toId(key)));
    }
    function _rangeRequest() internal returns (uint256 id) {
        vm.startPrank(lp);
        positions.approve(address(vault), 1);
        id = vault.createRequest(key, 1, 500e6, 500e6, 30 days, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }
    function _offer(uint256 amount) internal returns (NacreRangeOffer offer) {
        vm.startPrank(maker);
        usdc.approve(address(factory), amount);
        offer = NacreRangeOffer(factory.createOffer(amount, -60, 60, 30 days, 800));
        vm.stopPrank();
    }
    function testFundBeforeRequestBuySettleAndWithdraw() public {
        NacreRangeOffer offer = _offer(700e6);
        assertEq(usdc.balanceOf(address(offer)), 700e6);
        uint256 id = _rangeRequest();
        vm.startPrank(lp);
        offer.publish(id);
        NacreAquaUnderwriter.Quote memory q = offer.quoteFor(id);
        assertEq(q.premium, 40e6);
        usdc.approve(address(app), q.premium);
        app.buyCoverage(q);
        vm.stopPrank();
        assertEq(vault.reservedCollateral(), 500e6);
        assertEq(usdc.balanceOf(address(offer)), 240e6);
        vm.prank(maker);
        offer.closeAndWithdraw();
        assertEq(usdc.balanceOf(maker), 540e6);
        assertEq(vault.reservedCollateral(), 500e6);
        positions.addFees(1, 300e6, 0);
        vm.warp(block.timestamp + 30 days);
        vault.settle(id);
        assertEq(usdc.balanceOf(address(offer)), 300e6);
        vm.prank(maker);
        offer.closeAndWithdraw();
        assertEq(usdc.balanceOf(maker), 840e6);
        assertEq(positions.ownerOf(1), lp);
    }
    function testCapacityCannotBackTwoPoliciesAtOnce() public {
        NacreRangeOffer offer = _offer(500e6);
        uint256 first = _rangeRequest();
        positions.mint(lp, 2, key);
        vm.startPrank(lp);
        positions.approve(address(vault), 2);
        uint256 second = vault.createRequest(key, 2, 500e6, 500e6, 30 days, uint64(block.timestamp + 1 days));
        offer.publish(first);
        offer.publish(second);
        NacreAquaUnderwriter.Quote memory q1 = offer.quoteFor(first);
        NacreAquaUnderwriter.Quote memory q2 = offer.quoteFor(second);
        usdc.approve(address(app), 80e6);
        app.buyCoverage(q1);
        assertFalse(app.canFill(q2));
        vm.expectRevert();
        app.buyCoverage(q2);
        vm.stopPrank();
        assertEq(vault.reservedCollateral(), 500e6);
    }
    function testCloseRevokesPreparedQuotesAndOwnerOnlyWithdrawal() public {
        NacreRangeOffer offer = _offer(500e6);
        uint256 id = _rangeRequest();
        offer.publish(id);
        NacreAquaUnderwriter.Quote memory q = offer.quoteFor(id);
        vm.prank(attacker);
        vm.expectRevert("Only owner");
        offer.closeAndWithdraw();
        vm.prank(maker);
        offer.closeAndWithdraw();
        assertFalse(app.canFill(q));
        assertEq(usdc.allowance(address(offer), address(aqua)), 0);
    }
    function testTinyPositionCannotDrainRangeCapacity() public {
        NacreRangeOffer offer = _offer(500e6);
        uint256 id = _rangeRequest();
        positions.setTestLiquidity(1);
        assertEq(offer.maximumCap(1), 0);
        vm.expectRevert("Fee target exceeds position limit");
        offer.publish(id);
        assertEq(usdc.balanceOf(address(offer)), 500e6);
    }
    function testRejectMismatchedBinsDaysAndInvalidDeposits() public {
        uint256 id = _rangeRequest();
        vm.startPrank(maker);
        usdc.approve(address(factory), 1000e6);
        vm.expectRevert("Invalid amount");
        factory.createOffer(0, -60, 60, 30 days, 800);
        vm.expectRevert("Invalid bins");
        factory.createOffer(100e6, -61, 60, 30 days, 800);
        NacreRangeOffer wrongDays = NacreRangeOffer(factory.createOffer(500e6, -60, 60, 7 days, 800));
        NacreRangeOffer wrongBins = NacreRangeOffer(factory.createOffer(500e6, -50, 60, 30 days, 800));
        vm.stopPrank();
        vm.expectRevert("Duration or expiry mismatch");
        wrongDays.publish(id);
        vm.expectRevert("Different bins");
        wrongBins.publish(id);
    }
}
