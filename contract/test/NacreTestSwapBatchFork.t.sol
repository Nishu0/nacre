// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {NacreRangeOffersForkTest, IState, ITestToken} from "./NacreRangeOffersFork.t.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NacreTestSwapBatch} from "../src/NacreTestSwapBatch.sol";
contract NacreTestSwapBatchForkTest is NacreRangeOffersForkTest {
    function testBatchSwapsBoundedAndAtomic() public {
        vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC_URL"));
        weth = 0x3333C20E21Eeaed85766232B20641d56fd3788c4;
        pool = 0x03be77c419a9a391c642576e5468d32ba21250f59d750be76e1043efe50c5a16;
        tradingFee = 10000;
        (uint160 price,int24 tick,,) = IState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(pool);
        _mint(price, tick / 10 * 10 - 1000, tick / 10 * 10 + 1000);
        NacreTestSwapBatch router = new NacreTestSwapBatch();
        vm.startPrank(maker); ITestToken(weth).claim(); ITestToken(address(token)).claim();
        IERC20(weth).approve(address(router), .01 ether); token.approve(address(router), 30e6);
        NacreTestSwapBatch.Trade[] memory trades = new NacreTestSwapBatch.Trade[](2);
        trades[0] = NacreTestSwapBatch.Trade(true, .001 ether, 2e6, price * 99 / 100);
        trades[1] = NacreTestSwapBatch.Trade(false, 2e6, .0005 ether, price * 101 / 100);
        router.execute(_key(), trades, block.timestamp);
        uint256 beforeBalance = token.balanceOf(maker);
        trades[1].minimumOut = 1 ether;
        vm.expectRevert("Insufficient output"); router.execute(_key(), trades, block.timestamp);
        assertEq(token.balanceOf(maker), beforeBalance, "Atomic revert");
        vm.stopPrank();
    }
}
