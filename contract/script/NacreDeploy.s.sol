// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {HookMiner} from "@uniswap/v4-periphery/test/shared/HookMiner.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NacreFeeHook} from "../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";

/// @notice Deploy after setting POOL_MANAGER, POSITION_MANAGER, SETTLEMENT_TOKEN,
///         FEE_VALUE_ORACLE and AQUA. The oracle must have feeds configured.
contract NacreDeploy is Script {
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external returns (NacreFeeHook hook, NacrePolicyVault vault, NacreAquaUnderwriter app) {
        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        address positionManager = vm.envAddress("POSITION_MANAGER");
        address deployer = vm.envAddress("DEPLOYER");
        IERC20 settlement = IERC20(vm.envAddress("SETTLEMENT_TOKEN"));
        INacreFeeValueOracle oracle = INacreFeeValueOracle(vm.envAddress("FEE_VALUE_ORACLE"));
        IAqua aqua = IAqua(vm.envAddress("AQUA"));

        uint160 flags = Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.AFTER_ADD_LIQUIDITY_FLAG
            | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG;
        (address predicted, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER, flags, type(NacreFeeHook).creationCode,
            abi.encode(manager, positionManager, deployer)
        );

        vm.startBroadcast();
        hook = new NacreFeeHook{salt: salt}(manager, positionManager, deployer);
        require(address(hook) == predicted, "wrong hook address");
        vault = new NacrePolicyVault(settlement, INacrePositionManager(positionManager), oracle, hook);
        app = new NacreAquaUnderwriter(aqua, vault);
        hook.setController(address(vault));
        vault.setAquaApp(address(app));
        vm.stopBroadcast();
    }
}
