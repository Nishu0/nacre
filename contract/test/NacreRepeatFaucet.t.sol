// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {NacreTestUSDC} from "../src/NacreTestUSDC.sol";
import {INacreClaimToken, NacreRepeatFaucet} from "../src/NacreRepeatFaucet.sol";

contract NacreRepeatFaucetTest is Test {
    address internal constant DEPLOYED_TOKEN = 0xfa35D165b03B8eB193934D338Db8de536e84AAC8;
    address internal constant USER = address(0xB0B);

    function testSameWalletCanClaimRepeatedlyAfterItsOriginalClaim() public {
        NacreTestUSDC token = new NacreTestUSDC();
        NacreRepeatFaucet faucet = new NacreRepeatFaucet(INacreClaimToken(address(token)));

        vm.prank(USER);
        token.claim();
        assertTrue(token.claimed(USER));

        vm.startPrank(USER);
        faucet.claim();
        faucet.claim();
        vm.stopPrank();

        assertEq(token.balanceOf(USER), 30_000e6);
        assertEq(token.totalSupply(), 30_000e6);
        assertEq(faucet.amount(), 10_000e6);
    }

    function testForkExistingBaseSepoliaTokenCanBeClaimedAgain() public {
        if (block.chainid != 84532) return;
        INacreClaimToken token = INacreClaimToken(DEPLOYED_TOKEN);
        NacreRepeatFaucet faucet = new NacreRepeatFaucet(token);
        uint256 beforeBalance = token.balanceOf(USER);

        vm.startPrank(USER);
        faucet.claim();
        faucet.claim();
        vm.stopPrank();

        assertEq(token.balanceOf(USER), beforeBalance + 20_000e6);
    }
}
