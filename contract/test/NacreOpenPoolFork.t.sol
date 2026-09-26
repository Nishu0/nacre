// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {NacreOpenPool} from "../src/NacreOpenPool.sol";
import {NacreRangeOfferFactory, NacreRangeOffer} from "../src/NacreRangeOffers.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
interface IOpenPoolState { function getSlot0(bytes32) external view returns (uint160,int24,uint24,uint24); }
interface IClaim { function claim() external; }
contract NacreOpenPoolForkTest is Test {
    function setUp() public { vm.createSelectFork(vm.envString("BASE_SEPOLIA_RPC_URL")); }
    function testNonAdminCreatesPoolAndFundsSeparateBid() public {
        address maker = address(0x567890);
        IERC20 token = IERC20(0xfa35D165b03B8eB193934D338Db8de536e84AAC8);
        uint256 beforeBalance = token.balanceOf(maker);
        vm.startPrank(maker);
        NacreOpenPool created = new NacreOpenPool(3000, TickMath.getSqrtPriceAtTick(-197350));
        assertEq(created.creator(), maker);
        assertEq(token.balanceOf(maker), beforeBalance);
        NacreRangeOfferFactory factory = NacreRangeOfferFactory(created.offerFactory());
        assertEq(factory.poolId(), created.poolId());
        assertEq(factory.offerCount(), 0);
        (,int24 tick,,) = IOpenPoolState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(created.poolId());
        assertEq(tick, -197350);
        IClaim(address(token)).claim();
        token.approve(address(factory), 100e6);
        NacreRangeOffer offer = NacreRangeOffer(factory.createOffer(100e6, -198000, -197000, 30 days, 800));
        assertEq(offer.owner(), maker);
        assertEq(offer.poolId(), created.poolId());
        assertEq(token.balanceOf(address(offer)), 100e6);
        vm.expectRevert();
        new NacreOpenPool(3000, TickMath.getSqrtPriceAtTick(-197000));
        vm.stopPrank();
    }
    function testRejectsInvalidPriceAndFee() public {
        vm.expectRevert("Unsupported fee"); new NacreOpenPool(123, 1);
        vm.expectRevert("Invalid price"); new NacreOpenPool(3000, 0);
    }
}
