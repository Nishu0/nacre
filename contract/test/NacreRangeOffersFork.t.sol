// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {NacreFeeHook} from "../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";
import {NacreRangeOffer, NacreRangeOfferFactory} from "../src/NacreRangeOffers.sol";
interface ITestToken { function claim() external; }
interface IWeth { function deposit() external payable; }
interface IPermit { function approve(address,address,uint160,uint48) external; }
interface IPositions {
    function nextTokenId() external view returns (uint256);
    function modifyLiquidities(bytes calldata,uint256) external payable;
    function approve(address,uint256) external;
    function ownerOf(uint256) external view returns (address);
}
interface IState { function getSlot0(bytes32) external view returns (uint160,int24,uint24,uint24); }

contract NacreRangeOffersForkTest is Test {
    address lp = address(0x1234);
    address maker = address(0x5678);
    IERC20 token = IERC20(0xfa35D165b03B8eB193934D338Db8de536e84AAC8);
    address weth = 0x4200000000000000000000000000000000000006;
    address permit = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IPositions positions = IPositions(0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80);
    NacrePolicyVault vault = NacrePolicyVault(0x5Dc6026219bbB88998A8BA61a4490001EC998FdA);
    NacreAquaUnderwriter app = NacreAquaUnderwriter(0xFCF408B807D8a188B6FEfD8666799F1C9684DEFc);
    bytes32 pool = 0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56;
    function testDeployedPoolMintRequestFundBuyAndReturnNft() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);
        vault = new NacrePolicyVault(token, INacrePositionManager(address(positions)),
            INacreFeeValueOracle(0x5c7Bb75ae16bF790e73C8A92f3041EeF01778504),
            NacreFeeHook(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00));
        app = new NacreAquaUnderwriter(IAqua(0xb33a189b5BAb0A65Af9aceE0608CDEc47f7a8E28), vault);
        vault.setAquaApp(address(app));
        NacreRangeOfferFactory factory = new NacreRangeOfferFactory(app, pool);
        (uint160 price, int24 tick,,) = IState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(pool);
        int24 lower = (tick / 10) * 10 - 1000;
        int24 upper = (tick / 10) * 10 + 1000;
        vm.startPrank(maker);
        ITestToken(address(token)).claim();
        token.approve(address(factory), 100e6);
        NacreRangeOffer offer = NacreRangeOffer(factory.createOffer(100e6, lower, upper, 7 days, 800));
        vm.stopPrank();
        uint256 tokenId = _mint(price, lower, upper);
        vm.startPrank(lp);
        PoolKey memory key = _key();
        positions.approve(address(vault), tokenId);
        uint256 request = vault.createRequest(key, tokenId, 10e6, 10e6, 7 days, uint64(block.timestamp + 1 hours));
        offer.publish(request);
        NacreAquaUnderwriter.Quote memory q = offer.quoteFor(request);
        token.approve(address(app), q.premium);
        app.buyCoverage(q);
        vm.stopPrank();
        assertEq(vault.reservedCollateral(), 10e6);
        assertEq(positions.ownerOf(tokenId), address(vault));
        assertEq(token.balanceOf(address(offer)), 90.8e6);
        vm.warp(block.timestamp + 7 days);
        assertEq(vault.settle(request), 10e6);
        assertEq(positions.ownerOf(tokenId), lp);
        vm.prank(maker);
        offer.closeAndWithdraw();
        assertEq(token.balanceOf(maker), 9990.8e6);
    }
    function testDeployedTestWethFaucetMintAndCoverage() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) { vm.skip(true); return; }
        vm.createSelectFork(rpc);
        weth = 0x3333C20E21Eeaed85766232B20641d56fd3788c4;
        pool = 0x743bf18c39cc3c9a033ca8dd020a49609e82c25243bc005f5bb5520e4a5748ae;
        vault = NacrePolicyVault(0x879Ead283E76aFc12865CA43a0A3F10c3626CCe0);
        app = NacreAquaUnderwriter(0x0D2ED632E5A10aB713d183369687720d4e3817Cd);
        NacreRangeOfferFactory factory = NacreRangeOfferFactory(0x815bAcd48995FC5AbE143bC08aFcB40c7306f3B7);
        (uint160 price, int24 tick,,) = IState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(pool);
        int24 lower = (tick / 10) * 10 - 1000;
        int24 upper = (tick / 10) * 10 + 1000;
        uint256 tokenId = _mint(price, lower, upper);
        assertEq(positions.ownerOf(tokenId), lp);
        assertEq(lp.balance, 0, "No ETH deposit is required for nWETH");
        vm.startPrank(maker);
        ITestToken(address(token)).claim();
        token.approve(address(factory), 100e6);
        NacreRangeOffer offer = NacreRangeOffer(factory.createOffer(100e6, lower, upper, 7 days, 800));
        vm.stopPrank();
        vm.startPrank(lp);
        positions.approve(address(vault), tokenId);
        uint256 request = vault.createRequest(_key(), tokenId, 1e6, 1e6, 7 days, uint64(block.timestamp + 1 hours));
        offer.publish(request);
        NacreAquaUnderwriter.Quote memory q = offer.quoteFor(request);
        token.approve(address(app), q.premium);
        app.buyCoverage(q);
        vm.stopPrank();
        assertEq(positions.ownerOf(tokenId), address(vault));
        vm.warp(block.timestamp + 7 days + 1);
        vault.settle(request);
        assertEq(positions.ownerOf(tokenId), lp);
        assertEq(token.balanceOf(address(offer)), 99.08e6);
    }
    function _key() internal view returns (PoolKey memory) {
        return PoolKey(Currency.wrap(weth), Currency.wrap(address(token)), 500, 10,
            IHooks(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00));
    }
    function _mint(uint160 price, int24 lower, int24 upper) internal returns (uint256 tokenId) {
        if (weth == 0x4200000000000000000000000000000000000006) vm.deal(lp, 2 ether);
        vm.startPrank(lp);
        ITestToken(address(token)).claim();
        if (weth == 0x4200000000000000000000000000000000000006) IWeth(weth).deposit{value: 1 ether}();
        else ITestToken(weth).claim();
        IERC20(weth).approve(permit, 1 ether);
        token.approve(permit, 3000e6);
        IPermit(permit).approve(weth, address(positions), 1 ether, uint48(block.timestamp + 1 hours));
        IPermit(permit).approve(address(token), address(positions), 3000e6, uint48(block.timestamp + 1 hours));
        PoolKey memory key = _key();
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(price,
            TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), 1 ether, 3000e6);
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(key, lower, upper, uint256(liquidity - 1), uint128(1 ether), uint128(3000e6), lp, bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1);
        tokenId = positions.nextTokenId();
        positions.modifyLiquidities(abi.encode(hex"020d", params), block.timestamp + 1 hours);
        vm.stopPrank();
    }

}
