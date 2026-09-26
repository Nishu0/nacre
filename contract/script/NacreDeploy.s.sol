// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NacreFeeHook} from "../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";
import {NacreChainlinkFeeOracle, IAggregatorV3} from "../src/NacreChainlinkFeeOracle.sol";

/// @notice Deploys Nacre with local Aqua and a fresh oracle when their addresses
///         are absent. Base Sepolia only; this deployment is for test tokens.
contract NacreDeploy is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external returns (NacreFeeHook hook, NacrePolicyVault vault, NacreAquaUnderwriter app) {
        require(block.chainid == 84532, "Base Sepolia only");
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address positionManager = vm.envAddress("POSITION_MANAGER");
        address deployer = vm.envAddress("DEPLOYER");
        IERC20 settlement = IERC20(vm.envAddress("SETTLEMENT_TOKEN"));
        require(CREATE2_DEPLOYER.code.length != 0, "CREATE2 deployer missing");

        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        hook = _deployHook(manager, positionManager, deployer);
        vault = new NacrePolicyVault(settlement, INacrePositionManager(positionManager), _resolveOracle(settlement), hook);
        app = new NacreAquaUnderwriter(_resolveAqua(), vault);
        hook.setController(address(vault));
        vault.setAquaApp(address(app));
        vm.stopBroadcast();
    }

    function _deployHook(IPoolManager manager, address positionManager, address deployer)
        internal returns (NacreFeeHook hook)
    {
        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        bytes memory args = abi.encode(manager, positionManager, deployer);
        (address predicted, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER, flags, type(NacreFeeHook).creationCode, args
        );
        (bool deployed,) = CREATE2_DEPLOYER.call(
            abi.encodePacked(salt, type(NacreFeeHook).creationCode, args)
        );
        require(deployed && predicted.code.length != 0, "hook deployment failed");
        hook = NacreFeeHook(predicted);
    }

    function _resolveOracle(IERC20 settlement) internal returns (INacreFeeValueOracle) {
        address configured = vm.envOr("FEE_VALUE_ORACLE", address(0));
        if (configured != address(0)) return INacreFeeValueOracle(configured);
        NacreChainlinkFeeOracle oracle = new NacreChainlinkFeeOracle(address(settlement), 2 hours);
        oracle.configureFeed(vm.envAddress("WETH"), IAggregatorV3(vm.envAddress("WETH_USD_FEED")));
        return INacreFeeValueOracle(address(oracle));
    }

    function _resolveAqua() internal returns (IAqua) {
        address configured = vm.envOr("AQUA", address(0));
        return configured == address(0) ? IAqua(address(new Aqua())) : IAqua(configured);
    }
}
