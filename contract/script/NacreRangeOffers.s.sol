// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Script} from "forge-std/Script.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {NacreFeeHook} from "../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../src/NacrePolicyVault.sol";
import {NacreRangeOfferFactory} from "../src/NacreRangeOffers.sol";
contract DeployNacreRangeOffers is Script {
    function run() external returns (NacreRangeOfferFactory factory) {
        require(block.chainid == 84532, "Base Sepolia only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(vm.addr(key) == vm.envAddress("DEPLOYER"), "Deployer mismatch");
        vm.startBroadcast(key);
        NacrePolicyVault vault = new NacrePolicyVault(
            IERC20(0xfa35D165b03B8eB193934D338Db8de536e84AAC8),
            INacrePositionManager(0x4B2C77d209D3405F41a037Ec6c77F7F5b8e2ca80),
            INacreFeeValueOracle(0x5c7Bb75ae16bF790e73C8A92f3041EeF01778504),
            NacreFeeHook(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00)
        );
        NacreAquaUnderwriter app = new NacreAquaUnderwriter(IAqua(0xb33a189b5BAb0A65Af9aceE0608CDEc47f7a8E28), vault);
        vault.setAquaApp(address(app));
        factory = new NacreRangeOfferFactory(
            app,
            0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56
        );
        vm.stopBroadcast();
    }
}

contract DeployNacreRangeFactory is Script {
    function run() external returns (NacreRangeOfferFactory factory) {
        require(block.chainid == 84532, "Base Sepolia only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        require(vm.addr(key) == vm.envAddress("DEPLOYER"), "Deployer mismatch");
        vm.startBroadcast(key);
        factory = new NacreRangeOfferFactory(NacreAquaUnderwriter(0x0D2ED632E5A10aB713d183369687720d4e3817Cd),
            0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56);
        vm.stopBroadcast();
    }
}
