// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
/// Explicitly labeled synthetic activity on faucet-token Base Sepolia pools.
contract NacreTestSwapBatch is IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using BalanceDeltaLibrary for BalanceDelta;
    IPoolManager constant manager = IPoolManager(0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408);
    struct Trade { bool zeroForOne; uint128 amountIn; uint128 minimumOut; uint160 priceLimit; }
    event TestActivity(bytes32 indexed poolId, address indexed trader, uint256 swaps);
    function execute(PoolKey calldata key, Trade[] calldata trades, uint256 deadline) external nonReentrant {
        require(block.chainid == 84532 && block.timestamp <= deadline, "Network or deadline");
        require(Currency.unwrap(key.currency0) == 0x3333C20E21Eeaed85766232B20641d56fd3788c4
            && Currency.unwrap(key.currency1) == 0xfa35D165b03B8eB193934D338Db8de536e84AAC8, "Test tokens only");
        require(address(key.hooks) == 0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00 && key.tickSpacing == 10 && key.fee <= 10000, "Nacre test pools only");
        require(trades.length > 0 && trades.length <= 20, "One to twenty swaps");
        manager.unlock(abi.encode(msg.sender, key, trades));
        emit TestActivity(PoolId.unwrap(PoolIdLibrary.toId(key)), msg.sender, trades.length);
    }
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(manager), "Only PoolManager");
        (address payer, PoolKey memory key, Trade[] memory trades) = abi.decode(data, (address, PoolKey, Trade[]));
        for (uint256 i; i < trades.length; ++i) {
            Trade memory t = trades[i]; require(t.amountIn > 0 && t.minimumOut > 0, "Invalid trade");
            BalanceDelta delta = manager.swap(key, SwapParams(t.zeroForOne, -int256(uint256(t.amountIn)), t.priceLimit), "");
            int128 input = t.zeroForOne ? delta.amount0() : delta.amount1();
            require(input < 0 && uint256(-int256(input)) <= t.amountIn, "Input limit");
            int128 output = t.zeroForOne ? delta.amount1() : delta.amount0();
            require(output > 0 && uint128(output) >= t.minimumOut, "Insufficient output");
            _settle(key.currency0, delta.amount0(), payer); _settle(key.currency1, delta.amount1(), payer);
        }
        return "";
    }
    function _settle(Currency currency, int128 delta, address payer) private {
        if (delta < 0) { manager.sync(currency); IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(manager), uint256(-int256(delta))); manager.settle(); }
        else if (delta > 0) manager.take(currency, payer, uint128(delta));
    }
}
