// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";

/// @notice Admin-operated initialization for Nacre's Base Sepolia demo pair.
/// @dev This restricts the Nacre launcher path. Uniswap's PoolManager is
///      permissionless, so a direct initialize call is outside this guard.
contract NacrePoolLauncher {
    using PoolIdLibrary for PoolKey;

    address public immutable admin;
    IPoolManager public immutable poolManager;
    address public immutable weth;
    address public immutable testUsdc;
    IHooks public immutable hook;
    PoolId public immutable poolId;
    bool public launched;

    event PoolLaunched(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, address indexed admin);

    constructor(address admin_, IPoolManager manager_, address weth_, address testUsdc_, IHooks hook_) {
        require(admin_ != address(0) && address(manager_) != address(0)
            && weth_ != address(0) && testUsdc_ != address(0) && address(hook_) != address(0), "zero address");
        require(weth_ != testUsdc_, "same currency");
        admin = admin_;
        poolManager = manager_;
        weth = weth_;
        testUsdc = testUsdc_;
        hook = hook_;
        poolId = poolKey().toId();
    }

    function poolKey() public view returns (PoolKey memory) {
        (address first, address second) = weth < testUsdc ? (weth, testUsdc) : (testUsdc, weth);
        return PoolKey({
            currency0: Currency.wrap(first), currency1: Currency.wrap(second),
            fee: 500, tickSpacing: 10, hooks: hook
        });
    }

    function initialize(uint160 sqrtPriceX96) external returns (int24 tick) {
        require(msg.sender == admin, "admin only");
        require(!launched, "already launched");
        require(sqrtPriceX96 != 0, "zero price");
        launched = true;
        tick = poolManager.initialize(poolKey(), sqrtPriceX96);
        emit PoolLaunched(PoolId.unwrap(poolId), sqrtPriceX96, tick, msg.sender);
    }
}
