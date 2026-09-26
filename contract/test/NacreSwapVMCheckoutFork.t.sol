// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {SwapVMForkFixture} from "./SwapVMForkFixture.sol";

import {NacreSwapVMCheckout} from "../src/NacreSwapVMCheckout.sol";
import {NacreSwapVMMarket} from "../src/NacreSwapVMMarket.sol";
import {NacreSwapVMRouter} from "../src/NacreSwapVMRouter.sol";
import {NacreLimitedOfferFactory} from "../src/NacreLimitedOffers.sol";
import {NacrePolicyVault} from "../src/NacrePolicyVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITestToken} from "./NacreRangeOffersFork.t.sol";
import {ISwapVM} from "../lib/swap-vm/contracts/interfaces/ISwapVM.sol";
contract NacreSwapVMCheckoutForkTest is SwapVMForkFixture {
    NacreSwapVMCheckout zap;
    NacreSwapVMMarket swapMarket;
    NacreSwapVMRouter router;
    function setUp() public override {
        super.setUp();
        router = new NacreSwapVMRouter(address(app.AQUA()), weth, address(this));
        swapMarket = new NacreSwapVMMarket(app.AQUA(), ISwapVM(address(router)), IERC20(weth), token);
        ITestToken(weth).claim(); IERC20(weth).approve(address(swapMarket), 1 ether);
        swapMarket.fundQuote(1 ether, 2700e6, uint40(block.timestamp + 1 hours));
        zap = new NacreSwapVMCheckout(checkout.bidFactory(), swapMarket);
        vm.startPrank(lp);
        IERC20(weth).transfer(address(0xdead), IERC20(weth).balanceOf(lp));
        token.approve(address(zap), 6000e6);
        vm.stopPrank();
    }
    function testSwapVMSingleTokenPurchaseAndSettlement() public {
        (uint256 input, bytes32 hash,) = zap.quoteSwap(terms.amount0Max);
        assertEq(input, 2700e6);
        uint256 buyerBefore = token.balanceOf(lp);
        vm.prank(lp); (address account, uint256 nft, uint256 request) = zap.supplyWithUSDC(terms, input + 1e6, hash);
        assertEq(zap.beneficiaries(account), lp);
        assertEq(positions.ownerOf(nft), address(vault));
        (,,, NacrePolicyVault.Status status) = vault.requestTerms(request);
        assertEq(uint256(status), uint256(NacrePolicyVault.Status.Active));
        assertEq(token.balanceOf(address(swapMarket)), input);
        assertEq(token.balanceOf(address(offer)), 1.08e6);
        assertLt(buyerBefore - token.balanceOf(lp), input + terms.amount1Max + terms.maxPremium);
        assertEq(token.allowance(address(zap), address(router)), 0);
        assertEq(token.balanceOf(address(zap)), 0);
        assertEq(IERC20(weth).balanceOf(address(zap)), 0);
        vm.warp(block.timestamp + 7 days + 1); vault.settle(request);
        assertEq(positions.ownerOf(nft), lp);
    }
    function _assertZapReverts(uint256 maxInput, bytes32 hash) private {
        uint256 buyerBefore = token.balanceOf(lp); uint256 marketBefore = IERC20(weth).balanceOf(address(swapMarket));
        uint256 nextNft = positions.nextTokenId(); uint256 nextRequest = vault.nextRequestId();
        vm.prank(lp); vm.expectRevert(); zap.supplyWithUSDC(terms, maxInput, hash);
        assertEq(token.balanceOf(lp), buyerBefore);
        assertEq(IERC20(weth).balanceOf(address(swapMarket)), marketBefore);
        assertEq(token.balanceOf(address(swapMarket)), 0);
        assertEq(positions.nextTokenId(), nextNft); assertEq(vault.nextRequestId(), nextRequest);
        assertEq(token.allowance(address(zap), address(router)), 0);
    }
    function testSwapVMInsufficientMaxInputRevertsEverything() public { _assertZapReverts(2699e6, swapMarket.orderHash()); }
    function testSwapVMFailedCoverageRevertsSwapAndMint() public {
        vm.prank(maker); offer.setPremiumBps(900);
        _assertZapReverts(2700e6, swapMarket.orderHash());
    }
    function testSwapVMClosedBidRevertsEverything() public {
        vm.prank(maker); offer.closeAndWithdraw(); _assertZapReverts(2700e6, swapMarket.orderHash());
    }
    function testSwapVMStaleQuoteRejected() public { _assertZapReverts(2700e6, bytes32(uint256(1))); }
    function testSwapVMClosedMarketRejected() public { swapMarket.close(); _assertZapReverts(2700e6, swapMarket.orderHash()); }
    function testSwapVMExpiryRejected() public { vm.warp(block.timestamp + 1 hours); terms.deadline = block.timestamp + 600; _assertZapReverts(2700e6, swapMarket.orderHash()); }
    function testSwapVMCannotSpendSomeoneElsesBalance() public {
        bytes32 hash = swapMarket.orderHash();
        vm.prank(address(0x7777)); vm.expectRevert(); zap.supplyWithUSDC(terms, 2700e6, hash);
    }
    function testSwapVMPreservesDonations() public {
        vm.prank(lp); token.transfer(address(zap), 1e6);
        bytes32 hash = swapMarket.orderHash();
        vm.prank(lp); zap.supplyWithUSDC(terms, 2701e6, hash);
        assertEq(token.balanceOf(address(zap)), 1e6);
    }
}
