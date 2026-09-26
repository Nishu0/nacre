// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {NacreRangeOfferFactory} from "./NacreRangeOffers.sol";
import {NacreAquaUnderwriter} from "./NacreAquaUnderwriter.sol";

/// @notice Anyone can initialize a supported Nacre test pool and its empty bid factory.
/// @dev No tokens are pulled. PoolManager atomically rejects duplicate pool keys.
contract NacreOpenPool {
    using PoolIdLibrary for PoolKey;
    address public immutable creator;
    bytes32 public immutable poolId;
    address public immutable offerFactory;
    address constant MANAGER = 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408;
    address constant WETH = 0x3333C20E21Eeaed85766232B20641d56fd3788c4;
    address constant USDC = 0xfa35D165b03B8eB193934D338Db8de536e84AAC8;
    address constant HOOK = 0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00;
    address constant APP = 0x0D2ED632E5A10aB713d183369687720d4e3817Cd;

    event PoolCreated(bytes32 indexed poolId, address indexed creator, address offerFactory,
        uint24 fee, uint160 sqrtPriceX96, int24 tick);

    constructor(uint24 fee, uint160 sqrtPriceX96) {
        require(block.chainid == 84532, "Base Sepolia only");
        require(fee == 100 || fee == 500 || fee == 3000 || fee == 10000, "Unsupported fee");
        require(sqrtPriceX96 > 0, "Invalid price");
        PoolKey memory key = PoolKey(Currency.wrap(WETH), Currency.wrap(USDC), fee, 10, IHooks(HOOK));
        creator = msg.sender;
        poolId = PoolId.unwrap(key.toId());
        int24 tick = IPoolManager(MANAGER).initialize(key, sqrtPriceX96);
        offerFactory = address(new NacreRangeOfferFactory(NacreAquaUnderwriter(APP), poolId));
        emit PoolCreated(poolId, msg.sender, offerFactory, fee, sqrtPriceX96, tick);
    }
}
