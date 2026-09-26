// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {NacreRangeOffersForkTest, IState, ITestToken} from "./NacreRangeOffersFork.t.sol";
import {NacreLimitedOffer, NacreLimitedOfferFactory} from "../src/NacreLimitedOffers.sol";
import {NacreRangeOffer} from "../src/NacreRangeOffers.sol";
import {NacrePolicyVault} from "../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";

contract NacreSubrangeOffersForkTest is NacreRangeOffersForkTest {
    NacreLimitedOffer offer;
    int24 low;
    int24 high;
    uint160 price;
    uint160 buyerCounter = 0x10000;
    mapping(uint256 => address) buyers;
    function _setupEnvelope() internal {
        vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC_URL"));
        weth = 0x3333C20E21Eeaed85766232B20641d56fd3788c4;
        pool = 0x03be77c419a9a391c642576e5468d32ba21250f59d750be76e1043efe50c5a16;
        tradingFee = 10000;
        vault = NacrePolicyVault(0x879Ead283E76aFc12865CA43a0A3F10c3626CCe0);
        app = NacreAquaUnderwriter(0x0D2ED632E5A10aB713d183369687720d4e3817Cd);
        int24 tick;
        (price,tick,,) = IState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(pool);
        low = tick / 10 * 10 - 1000; high = tick / 10 * 10 + 1000;
        NacreLimitedOfferFactory factory = new NacreLimitedOfferFactory(app);
        NacreLimitedOfferFactory.Bid[] memory bids = new NacreLimitedOfferFactory.Bid[](1);
        bids[0] = NacreLimitedOfferFactory.Bid(10000, 2e6, low, high, 7 days, 800, 1e6, 2);
        vm.startPrank(maker); ITestToken(address(token)).claim(); token.approve(address(factory), 2e6);
        offer = NacreLimitedOffer(factory.createOffers(bids)[0]); vm.stopPrank();
        assertTrue(offer.supportsSubranges());
    }
    function _requestRange(int24 lower, int24 upper) internal returns (uint256 id) {
        lp = address(++buyerCounter);
        uint256 nft = _mint(price, lower, upper);
        vm.startPrank(lp); positions.approve(address(vault), nft);
        id = vault.createRequest(_key(), nft, 1e6, 1e6, 7 days, uint64(block.timestamp + 1 hours));
        vm.stopPrank();
        buyers[id] = lp;
    }
    function testSubrangesShareSpotsAndCapitalThroughPurchaseAndSettlement() public {
        _setupEnvelope();
        uint256 first = _requestRange(low + 200, high - 200);
        uint256 second = _requestRange(low + 400, high - 300);
        vm.startPrank(maker); offer.publish(first); offer.publish(second); vm.stopPrank();
        assertEq(offer.availableSpots(), 0);
        assertEq(offer.unreservedCapital(), 0);
        uint256 third = _requestRange(low + 100, high - 100);
        vm.prank(lp); vm.expectRevert("No spots remaining"); offer.publish(third);
        vm.startPrank(buyers[first]);
        NacreAquaUnderwriter.Quote memory q = offer.quoteFor(first);
        token.approve(address(app), q.premium); app.buyCoverage(q);
        vm.stopPrank(); vm.startPrank(buyers[second]);
        q = offer.quoteFor(second);
        token.approve(address(app), q.premium); app.buyCoverage(q); vm.stopPrank();
        assertEq(offer.availableSpots(), 0);
        assertEq(token.balanceOf(address(offer)), 160000);
        vm.warp(block.timestamp + 7 days + 1);
        assertEq(vault.settle(first), 1e6); assertEq(vault.settle(second), 1e6);
        assertEq(offer.availableSpots(), 2);
    }
    function testSubrangeCannotExtendEitherFundedBoundary() public {
        _setupEnvelope();
        uint256 below = _requestRange(low - 10, high - 200);
        uint256 above = _requestRange(low + 200, high + 10);
        vm.expectRevert("Different bins"); offer.quoteFor(below);
        vm.expectRevert("Different bins"); offer.quoteFor(above);
        assertEq(offer.availableSpots(), 2);
        assertEq(offer.unreservedCapital(), 2e6);
        uint256 exact = _requestRange(low, high);
        assertEq(offer.quoteFor(exact).payoutCap, 1e6);
    }
    function testLegacyOffersStillRequireExactBins() public {
        _setupEnvelope();
        NacreRangeOffer legacy = new NacreRangeOffer(maker, app, pool, low, high, 7 days, 800, 1e6);
        vm.prank(maker); token.transfer(address(legacy), 1e6);
        uint256 narrow = _requestRange(low + 100, high - 100);
        vm.expectRevert("Different bins"); legacy.quoteFor(narrow);
    }
}
