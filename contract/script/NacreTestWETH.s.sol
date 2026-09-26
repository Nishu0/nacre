// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {NacreTestWETH} from "../src/NacreTestWETH.sol";
import {NacrePoolLauncher} from "../src/NacrePoolLauncher.sol";
import {NacreChainlinkFeeOracle, IAggregatorV3} from "../src/NacreChainlinkFeeOracle.sol";
import {NacreRangeOfferFactory} from "../src/NacreRangeOffers.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";

/// @notice Initializes the new test-token pool at deployment; the admin remains the user wallet.
contract NacreTestPoolLauncher is NacrePoolLauncher {
    constructor(address admin_, IPoolManager manager_, address weth_, address usdc_, IHooks hook_, uint160 price)
        NacrePoolLauncher(admin_, manager_, weth_, usdc_, hook_) {
        launched = true;
        int24 tick = manager_.initialize(poolKey(), price);
        emit PoolLaunched(PoolId.unwrap(poolId), price, tick, admin_);
    }
}

contract DeployNacreTestWETH is Script {
    function run() external returns (NacreTestWETH token, NacreTestPoolLauncher launcher, NacreRangeOfferFactory factory) {
        require(block.chainid == 84532, "Base Sepolia only");
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        require(vm.addr(privateKey) == vm.envAddress("DEPLOYER"), "Deployer mismatch");
        address usdc = 0xfa35D165b03B8eB193934D338Db8de536e84AAC8;
        address create2 = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
        bytes32 codeHash = keccak256(type(NacreTestWETH).creationCode);
        bytes32 salt;
        address predicted;
        for (uint256 i; ; i++) {
            salt = bytes32(i);
            predicted = vm.computeCreate2Address(salt, codeHash, create2);
            if (predicted < usdc && predicted.code.length == 0) break;
        }
        vm.startBroadcast(privateKey);
        (bool ok,) = create2.call(abi.encodePacked(salt, type(NacreTestWETH).creationCode));
        require(ok && predicted.code.length > 0, "Token deploy failed");
        token = NacreTestWETH(predicted);
        NacreChainlinkFeeOracle oracle = NacreChainlinkFeeOracle(0x5c7Bb75ae16bF790e73C8A92f3041EeF01778504);
        oracle.configureFeed(predicted, oracle.feedFor(0x4200000000000000000000000000000000000006));
        launcher = new NacreTestPoolLauncher(
            0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288,
            IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408), predicted, usdc,
            IHooks(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00), uint160(vm.envUint("TEST_WETH_SQRT_PRICE"))
        );
        factory = new NacreRangeOfferFactory(NacreAquaUnderwriter(0x0D2ED632E5A10aB713d183369687720d4e3817Cd), PoolId.unwrap(launcher.poolId()));
        vm.stopBroadcast();
    }
}
