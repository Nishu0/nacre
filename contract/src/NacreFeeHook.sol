// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Records fees actually realized by covered PositionManager NFTs.
/// @dev A zero-liquidity decrease at expiry crystallizes uncollected fees. The
///      position NFT must be held by the vault so the LP cannot alter risk.
contract NacreFeeHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    error OnlyPoolManager();
    error OnlyController();
    error WrongPositionManager();
    error WrongHook();
    error PositionAlreadyCovered();
    error PositionNotCovered();
    error CoveredPositionCannotChangeLiquidity();
    error UnsupportedHook();

    struct FeeTotals { uint256 amount0; uint256 amount1; }

    IPoolManager public immutable poolManager;
    address public immutable positionManager;
    address public controller;
    address public immutable controllerSetter;
    mapping(bytes32 => bool) public covered;
    mapping(bytes32 => FeeTotals) public fees;

    event CoverageStarted(bytes32 indexed positionKey, PoolId indexed poolId, uint256 indexed tokenId);
    event CoverageStopped(bytes32 indexed positionKey);
    event FeesRecorded(bytes32 indexed positionKey, uint256 amount0, uint256 amount1);

    constructor(IPoolManager manager_, address positionManager_, address controllerSetter_) {
        require(address(manager_) != address(0) && positionManager_ != address(0)
            && controllerSetter_ != address(0), "zero address");
        poolManager = manager_;
        positionManager = positionManager_;
        controllerSetter = controllerSetter_;
    }

    modifier onlyManager() {
        if (msg.sender != address(poolManager)) revert OnlyPoolManager();
        _;
    }

    modifier onlyController() {
        if (msg.sender != controller) revert OnlyController();
        _;
    }

    /// @dev One-time link to the policy vault after the hook is CREATE2-mined.
    function setController(address controller_) external {
        if (msg.sender != controllerSetter || controller != address(0) || controller_ == address(0)) {
            revert OnlyController();
        }
        controller = controller_;
    }

    function positionKey(PoolId poolId, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(PoolId.unwrap(poolId), tokenId));
    }

    function startCoverage(PoolKey calldata key, uint256 tokenId) external onlyController returns (bytes32 id) {
        if (address(key.hooks) != address(this)) revert WrongHook();
        id = positionKey(key.toId(), tokenId);
        if (covered[id]) revert PositionAlreadyCovered();
        delete fees[id];
        covered[id] = true;
        emit CoverageStarted(id, key.toId(), tokenId);
    }

    function stopCoverage(PoolKey calldata key, uint256 tokenId) external onlyController {
        bytes32 id = positionKey(key.toId(), tokenId);
        if (!covered[id]) revert PositionNotCovered();
        covered[id] = false;
        emit CoverageStopped(id);
    }

    function feeTotals(PoolKey calldata key, uint256 tokenId)
        external view returns (uint256 amount0, uint256 amount1)
    {
        FeeTotals memory total = fees[positionKey(key.toId(), tokenId)];
        return (total.amount0, total.amount1);
    }

    function beforeAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata)
        external onlyManager returns (bytes4)
    {
        _checkModification(sender, key, params);
        return IHooks.beforeAddLiquidity.selector;
    }

    function beforeRemoveLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata)
        external onlyManager returns (bytes4)
    {
        _checkModification(sender, key, params);
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function _checkModification(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params) internal view {
        if (sender != positionManager) return;
        bytes32 id = positionKey(key.toId(), uint256(params.salt));
        if (covered[id] && params.liquidityDelta != 0) revert CoveredPositionCannotChangeLiquidity();
    }

    function afterAddLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params,
        BalanceDelta, BalanceDelta feesAccrued, bytes calldata)
        external onlyManager returns (bytes4, BalanceDelta)
    {
        _record(sender, key, params, feesAccrued);
        return (IHooks.afterAddLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function afterRemoveLiquidity(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params,
        BalanceDelta, BalanceDelta feesAccrued, bytes calldata)
        external onlyManager returns (bytes4, BalanceDelta)
    {
        _record(sender, key, params, feesAccrued);
        return (IHooks.afterRemoveLiquidity.selector, BalanceDeltaLibrary.ZERO_DELTA);
    }

    function _record(address sender, PoolKey calldata key, ModifyLiquidityParams calldata params, BalanceDelta accrued)
        internal
    {
        if (sender != positionManager) return;
        bytes32 id = positionKey(key.toId(), uint256(params.salt));
        if (!covered[id]) return;
        int128 amount0 = accrued.amount0();
        int128 amount1 = accrued.amount1();
        if (amount0 < 0 || amount1 < 0) revert CoveredPositionCannotChangeLiquidity();
        fees[id].amount0 += uint128(amount0);
        fees[id].amount1 += uint128(amount1);
        emit FeesRecorded(id, uint128(amount0), uint128(amount1));
    }

    // Only the liquidity callbacks are enabled by the mined hook address.
    function beforeInitialize(address, PoolKey calldata, uint160) external onlyManager returns (bytes4) { revert UnsupportedHook(); }
    function afterInitialize(address, PoolKey calldata, uint160, int24) external onlyManager returns (bytes4) { revert UnsupportedHook(); }
    function beforeSwap(address, PoolKey calldata, SwapParams calldata, bytes calldata)
        external onlyManager returns (bytes4, BeforeSwapDelta, uint24) { revert UnsupportedHook(); }
    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external onlyManager returns (bytes4, int128) { revert UnsupportedHook(); }
    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external onlyManager returns (bytes4) { revert UnsupportedHook(); }
    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external onlyManager returns (bytes4) { revert UnsupportedHook(); }
}
