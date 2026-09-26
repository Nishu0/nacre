// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {NacreTestUSDC} from "../src/NacreTestUSDC.sol";
import {NacrePoolLauncher} from "../src/NacrePoolLauncher.sol";

contract NacreDemoAssetsTest is Test {
    address internal constant ADMIN = address(0xA11CE);
    address internal constant WETH = address(0x4200);
    address internal constant MANAGER = address(0xBEEF);
    address internal constant HOOK = address(0xF00D);

    function testFaucetClaimsExactlyOnceWithSixDecimals() public {
        NacreTestUSDC token = new NacreTestUSDC();
        assertEq(token.decimals(), 6);
        vm.prank(ADMIN);
        token.claim();
        assertEq(token.balanceOf(ADMIN), 10_000e6);
        assertTrue(token.claimed(ADMIN));
        vm.prank(ADMIN);
        vm.expectRevert("Faucet already claimed");
        token.claim();
        vm.prank(address(0xB0B));
        token.claim();
        assertEq(token.totalSupply(), 20_000e6);
    }

    function testOnlyAdminInitializesTheFixedPoolOnce() public {
        NacreTestUSDC token = new NacreTestUSDC();
        vm.etch(MANAGER, hex"00");
        NacrePoolLauncher launcher = new NacrePoolLauncher(
            ADMIN, IPoolManager(MANAGER), WETH, address(token), IHooks(HOOK)
        );
        PoolKey memory key = launcher.poolKey();
        assertLt(uint160(Currency.unwrap(key.currency0)), uint160(Currency.unwrap(key.currency1)));
        assertEq(key.fee, 500);
        assertEq(key.tickSpacing, 10);
        vm.mockCall(MANAGER, abi.encodeWithSelector(IPoolManager.initialize.selector), abi.encode(int24(-200000)));
        vm.expectRevert("admin only");
        launcher.initialize(123456);
        vm.prank(ADMIN);
        assertEq(launcher.initialize(123456), -200000);
        assertTrue(launcher.launched());
        vm.prank(ADMIN);
        vm.expectRevert("already launched");
        launcher.initialize(123456);
    }
}
