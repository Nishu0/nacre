// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {INacreClaimToken, NacreRepeatFaucet} from "../src/NacreRepeatFaucet.sol";

contract DeployNacreRepeatFaucet is Script {
    address internal constant NACRE_TEST_USDC = 0xfa35D165b03B8eB193934D338Db8de536e84AAC8;

    function run() external returns (NacreRepeatFaucet faucet) {
        require(block.chainid == 84532, "Base Sepolia only");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        require(vm.addr(privateKey) == vm.envAddress("DEPLOYER"), "deployer key mismatch");
        vm.startBroadcast(privateKey);
        faucet = new NacreRepeatFaucet(INacreClaimToken(NACRE_TEST_USDC));
        vm.stopBroadcast();
    }
}
