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
abstract contract SwapVMForkFixture is Test {
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
    function setUp() public virtual {
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
}
