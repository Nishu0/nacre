// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script} from "forge-std/Script.sol";
import {NacrePayout} from "../src/NacrePayout.sol";

contract NacrePayoutScript is Script {
    function run() external returns (NacrePayout deployed) {
        vm.startBroadcast();
        deployed = new NacrePayout();
        vm.stopBroadcast();
    }
}
