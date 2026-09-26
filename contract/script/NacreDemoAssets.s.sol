// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {NacreTestUSDC} from "../src/NacreTestUSDC.sol";
import {NacrePoolLauncher} from "../src/NacrePoolLauncher.sol";

contract DeployNacreTestUSDC is Script {
    function run() external returns (NacreTestUSDC token) {
        require(block.chainid == 84532, "Base Sepolia only");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        token = new NacreTestUSDC();
        vm.stopBroadcast();
    }
}

contract DeployNacrePoolLauncher is Script {
    function run() external returns (NacrePoolLauncher launcher) {
        require(block.chainid == 84532, "Base Sepolia only");
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        launcher = new NacrePoolLauncher(
            vm.envAddress("NACRE_ADMIN"),
            IPoolManager(vm.envAddress("POOL_MANAGER")),
            vm.envAddress("WETH"),
            vm.envAddress("SETTLEMENT_TOKEN"),
            IHooks(vm.envAddress("NACRE_HOOK"))
        );
        vm.stopBroadcast();
    }
}
