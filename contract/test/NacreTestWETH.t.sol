// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {NacreTestWETH} from "../src/NacreTestWETH.sol";

contract NacreTestWETHTest is Test {
    function testRepeatClaimsGiveOneTokenEachWithoutEth() public {
        NacreTestWETH token = new NacreTestWETH();
        address user = address(0x123);
        vm.startPrank(user);
        token.claim();
        token.claim();
        vm.stopPrank();
        assertEq(token.balanceOf(user), 2 ether);
        assertEq(user.balance, 0);
        assertEq(token.totalSupply(), 2 ether);
        assertEq(token.decimals(), 18);
    }
    function testSeparateWalletsAndStandardTransfer() public {
        NacreTestWETH token = new NacreTestWETH();
        token.claim();
        vm.prank(address(0x456)); token.claim();
        token.transfer(address(0x456), .25 ether);
        assertEq(token.balanceOf(address(0x456)), 1.25 ether);
        assertEq(token.totalSupply(), 2 ether);
    }
}
