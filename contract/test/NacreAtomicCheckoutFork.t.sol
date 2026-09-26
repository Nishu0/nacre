// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {IPositions, IState} from "./NacreRangeOffersFork.t.sol";
import {NacreChainlinkFeeOracle, IAggregatorV3} from "../src/NacreChainlinkFeeOracle.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {NacreTestSwapBatch} from "../src/NacreTestSwapBatch.sol";
import {ITestToken} from "./NacreRangeOffersFork.t.sol";
import {NacreAtomicCheckout, NacreCheckoutAccount, NacreCheckoutTerms} from "../src/NacreAtomicCheckout.sol";
import {NacreLimitedOffer, NacreLimitedOfferFactory} from "../src/NacreLimitedOffers.sol";
import {NacrePolicyVault} from "../src/NacrePolicyVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";

interface IAtomicPermitAllowance { function allowance(address,address,address) external view returns (uint160,uint48,uint48); }
contract NacreAtomicCheckoutForkTest is Test {
    address lp;
    address maker = address(0x5678);
    address weth = 0x3333C20E21Eeaed85766232B20641d56fd3788c4;
    address permit = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IERC20 token = IERC20(0xfa35D165b03B8eB193934D338Db8de536e84AAC8);
    IPositions positions = IPositions(0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80);
    NacrePolicyVault vault = NacrePolicyVault(0x879Ead283E76aFc12865CA43a0A3F10c3626CCe0);
    NacreAquaUnderwriter app = NacreAquaUnderwriter(0x0D2ED632E5A10aB713d183369687720d4e3817Cd);
    NacreLimitedOffer offer;
    int24 low; int24 high; uint160 price;
    function _key() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(weth), Currency.wrap(address(token)), 10000, 10,
          IHooks(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00));
    }
    NacreAtomicCheckout checkout;
    NacreCheckoutTerms terms;
    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC_URL"), 47344900);
        int24 tick;
        (price,tick,,) = IState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(0x03be77c419a9a391c642576e5468d32ba21250f59d750be76e1043efe50c5a16);
        low = tick / 10 * 10 - 1000; high = tick / 10 * 10 + 1000;
        NacreLimitedOfferFactory factory = new NacreLimitedOfferFactory(app);
        NacreLimitedOfferFactory.Bid[] memory bids = new NacreLimitedOfferFactory.Bid[](1);
        bids[0] = NacreLimitedOfferFactory.Bid(10000, 2e6, low, high, 7 days, 800, 1e6, 2);
        vm.startPrank(maker); ITestToken(address(token)).claim(); token.approve(address(factory), 2e6);
        offer = NacreLimitedOffer(factory.createOffers(bids)[0]); vm.stopPrank();
        checkout = new NacreAtomicCheckout(factory);
        lp = address(0x9988);
        terms = NacreCheckoutTerms(_key(), address(offer), 0, low + 100, high - 100,
            LiquidityAmounts.getLiquidityForAmounts(price, TickMath.getSqrtPriceAtTick(low + 100),
              TickMath.getSqrtPriceAtTick(high - 100), 1 ether, 3000e6) - 1,
            1 ether, 3000e6, 1e6, 80000, block.timestamp + 600);
        vm.startPrank(lp); ITestToken(weth).claim(); ITestToken(address(token)).claim();
        IERC20(weth).approve(address(checkout), terms.amount0Max);
        token.approve(address(checkout), uint256(terms.amount1Max) + terms.maxPremium); vm.stopPrank();
    }
    function testAtomicSupplyProtectRefundAndPermissionlessSettlement() public {
        uint256 expectedNft = positions.nextTokenId();
        uint256 beforeReserved = vault.reservedCollateral();
        uint256 beforeTokens = token.balanceOf(lp);
        vm.prank(lp);
        (address account, uint256 nft, uint256 request) = checkout.supplyAndProtect(terms);
        assertEq(nft, expectedNft); assertEq(checkout.beneficiaries(account), lp);
        assertEq(positions.ownerOf(nft), address(vault));
        (address registeredLp, uint256 cap,, NacrePolicyVault.Status status) = vault.requestTerms(request);
        assertEq(registeredLp, account); assertEq(cap, 1e6);
        assertEq(uint256(status), uint256(NacrePolicyVault.Status.Active));
        assertEq(vault.reservedCollateral(), beforeReserved + cap);
        assertEq(token.balanceOf(address(offer)), 1.08e6);
        assertLt(beforeTokens - token.balanceOf(lp), uint256(terms.amount1Max) + terms.maxPremium);
        assertEq(token.balanceOf(account), 0); assertEq(IERC20(weth).balanceOf(account), 0);
        assertEq(token.allowance(account, permit), 0); assertEq(IERC20(weth).allowance(account, permit), 0);
        assertEq(token.allowance(account, address(app)), 0);
        (uint160 permitted0,,) = IAtomicPermitAllowance(permit).allowance(account, weth, address(positions));
        (uint160 permitted1,,) = IAtomicPermitAllowance(permit).allowance(account, address(token), address(positions));
        assertEq(permitted0, 0); assertEq(permitted1, 0);
        uint256 beforeSettle = token.balanceOf(lp);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(address(0x9999)); vault.settle(request);
        assertEq(positions.ownerOf(nft), lp);
        assertEq(token.balanceOf(lp), beforeSettle + 1e6);
        assertEq(token.balanceOf(account), 0);
        assertEq(offer.availableSpots(), 2);
        vm.expectRevert("Only checkout once"); NacreCheckoutAccount(account).execute(terms);
    }
    function testSettlementForwardsBothFeeTokens() public {
        vm.prank(lp); (address account, uint256 nft, uint256 request) = checkout.supplyAndProtect(terms);
        NacreTestSwapBatch router = new NacreTestSwapBatch();
        vm.startPrank(maker); ITestToken(weth).claim();
        IERC20(weth).approve(address(router), .01 ether); token.approve(address(router), 30e6);
        NacreTestSwapBatch.Trade[] memory trades = new NacreTestSwapBatch.Trade[](2);
        trades[0] = NacreTestSwapBatch.Trade(true, .001 ether, 2e6, price * 99 / 100);
        trades[1] = NacreTestSwapBatch.Trade(false, 2e6, .0005 ether, price * 101 / 100);
        router.execute(_key(), trades, block.timestamp); vm.stopPrank();
        uint256 wethBefore = IERC20(weth).balanceOf(lp); uint256 usdcBefore = token.balanceOf(lp);
        vm.warp(block.timestamp + 7 days + 1);
        // The fork cannot receive new oracle rounds after vm.warp. Keep the
        // fork's real price and model a fresh round timestamp at settlement.
        IAggregatorV3 feed = NacreChainlinkFeeOracle(address(vault.feeValueOracle())).feedFor(weth);
        (uint80 round, int256 answer,,, uint80 answered) = feed.latestRoundData();
        vm.mockCall(address(feed), abi.encodeCall(feed.latestRoundData, ()), abi.encode(round, answer, block.timestamp, block.timestamp, answered));
        uint256 payout = vault.settle(request);
        assertLt(payout, terms.feeCap);
        assertGt(IERC20(weth).balanceOf(lp), wethBefore);
        assertGt(token.balanceOf(lp), usdcBefore + payout);
        assertEq(positions.ownerOf(nft), lp);
        assertEq(token.balanceOf(account), 0); assertEq(IERC20(weth).balanceOf(account), 0);
    }
    function testOnlyBeneficiaryCanSetRecoveryRecipient() public {
        vm.prank(lp); (address account, uint256 nft, uint256 request) = checkout.supplyAndProtect(terms);
        NacreCheckoutAccount escrow = NacreCheckoutAccount(account);
        vm.expectRevert("Only beneficiary"); escrow.setSettlementRecipient(address(0x1111));
        vm.prank(lp); vm.expectRevert("Invalid recipient"); escrow.setSettlementRecipient(address(0));
        vm.prank(lp); escrow.setSettlementRecipient(address(0x1111));
        vm.warp(block.timestamp + 7 days + 1); vault.settle(request);
        assertEq(positions.ownerOf(nft), address(0x1111)); assertEq(token.balanceOf(address(0x1111)), 1e6);
    }
    function _assertRevertedPurchase() internal {
        uint256 nextNft = positions.nextTokenId(); uint256 nextRequest = vault.nextRequestId();
        uint256 usdcBefore = token.balanceOf(lp); uint256 wethBefore = IERC20(weth).balanceOf(lp);
        uint256 offerBefore = token.balanceOf(address(offer));
        vm.prank(lp); vm.expectRevert(); checkout.supplyAndProtect(terms);
        assertEq(positions.nextTokenId(), nextNft); assertEq(vault.nextRequestId(), nextRequest);
        assertEq(token.balanceOf(lp), usdcBefore); assertEq(IERC20(weth).balanceOf(lp), wethBefore);
        assertEq(token.balanceOf(address(offer)), offerBefore);
    }
    function testPremiumIncreaseRevertsMintAndAllTransfers() public {
        vm.prank(maker); offer.setPremiumBps(900); _assertRevertedPurchase();
        assertEq(offer.availableSpots(), 2);
    }
    function testClosedOfferRevertsMint() public {
        vm.prank(maker); offer.closeAndWithdraw(); _assertRevertedPurchase();
    }
    function testOutOfBoundsReverts() public { terms.tickLower = low - 10; _assertRevertedPurchase(); }
    function testExpiredDeadlineReverts() public { terms.deadline = block.timestamp; _assertRevertedPurchase(); }
    function testOversizedCapRevertsAll() public { terms.feeCap = 2e6; _assertRevertedPurchase(); }
    function testUnknownOfferCannotPullTokens() public { terms.offer = address(this); _assertRevertedPurchase(); }
    function testCannotBuyOwnBid() public { vm.prank(maker); vm.expectRevert("Cannot buy own bid"); checkout.supplyAndProtect(terms); }
    function testInsufficientLiquidityBudgetReverts() public { terms.amount0Max = 1; _assertRevertedPurchase(); }
    function testFilledSpotsRevertWithoutCreatingPosition() public {
        vm.startPrank(lp); checkout.supplyAndProtect(terms); vm.stopPrank();
        lp = address(0x9989);
        vm.startPrank(lp); ITestToken(weth).claim(); ITestToken(address(token)).claim();
        IERC20(weth).approve(address(checkout), 1 ether); token.approve(address(checkout), uint256(terms.amount1Max) + terms.maxPremium);
        checkout.supplyAndProtect(terms); vm.stopPrank();
        assertEq(offer.availableSpots(), 0);
        lp = address(0x9990);
        vm.startPrank(lp); ITestToken(weth).claim(); ITestToken(address(token)).claim();
        IERC20(weth).approve(address(checkout), 1 ether); token.approve(address(checkout), uint256(terms.amount1Max) + terms.maxPremium); vm.stopPrank();
        _assertRevertedPurchase();
    }
}
