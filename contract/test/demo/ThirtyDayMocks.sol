// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {NacreFeeHook} from "../../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../../src/NacreAquaUnderwriter.sol";

// Simulation fixtures only. Prices and fee accrual are supplied by the demo runner.
// Real NacrePolicyVault, NacreAquaUnderwriter, NacreFeeHook and Aqua execute settlement.
contract DemoToken is ERC20 {
    uint8 private immutable units;
    constructor(string memory name_, string memory symbol_, uint8 units_) ERC20(name_, symbol_) { units = units_; }
    function decimals() public view override returns (uint8) { return units; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract DemoPoolManager {
    int24 public currentTick;
    int24 public constant lower = -198410;
    int24 public constant upper = -196400;

    function setTick(int24 tick) external { currentTick = tick; }

    function extsload(bytes32) external view returns (bytes32) {
        // StateLibrary decodes sqrtPriceX96 from the low 160 bits and tick above it.
        return bytes32((uint256(uint24(currentTick)) << 160) | (uint256(1) << 96));
    }

    function collect(NacreFeeHook hook, PoolKey calldata key, uint256 tokenId, uint256 amount0, uint256 amount1)
        external
    {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: lower, tickUpper: upper, liquidityDelta: 0, salt: bytes32(tokenId)
        });
        hook.beforeRemoveLiquidity(msg.sender, key, params, "");
        BalanceDelta accrued = toBalanceDelta(int128(uint128(amount0)), int128(uint128(amount1)));
        hook.afterRemoveLiquidity(msg.sender, key, params, BalanceDeltaLibrary.ZERO_DELTA, accrued, "");
    }
}

contract DemoPositionManager is ERC721 {
    DemoPoolManager public immutable manager;
    NacreFeeHook public immutable hook;
    mapping(uint256 => PoolKey) private keys;
    mapping(uint256 => uint256) public pending0;
    mapping(uint256 => uint256) public pending1;
    uint128 public testLiquidity = 1e23;
    function getPositionLiquidity(uint256) external view returns (uint128) { return testLiquidity; }
    function setTestLiquidity(uint128 value) external { testLiquidity = value; }

    constructor(DemoPoolManager manager_, NacreFeeHook hook_) ERC721("Mock v4 position", "M-V4") {
        manager = manager_;
        hook = hook_;
    }

    function mint(address owner, uint256 tokenId, PoolKey calldata key) external {
        keys[tokenId] = key;
        _mint(owner, tokenId);
    }

    function addFees(uint256 tokenId, uint256 amount0, uint256 amount1) external {
        pending0[tokenId] += amount0;
        pending1[tokenId] += amount1;
        DemoToken(Currency.unwrap(keys[tokenId].currency0)).mint(address(this), amount0);
        DemoToken(Currency.unwrap(keys[tokenId].currency1)).mint(address(this), amount1);
    }

    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256) {
        PositionInfo info = PositionInfoLibrary.initialize(keys[tokenId], manager.lower(), manager.upper());
        return (keys[tokenId], PositionInfo.unwrap(info));
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"0111"), "unexpected actions");
        (uint256 tokenId, uint256 liquidity,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        require(liquidity == 0 && ownerOf(tokenId) == msg.sender, "not owner");
        uint256 amount0 = pending0[tokenId];
        uint256 amount1 = pending1[tokenId];
        pending0[tokenId] = 0;
        pending1[tokenId] = 0;
        PoolKey memory key = keys[tokenId];
        manager.collect(hook, key, tokenId, amount0, amount1);
        if (amount0 != 0) DemoToken(Currency.unwrap(key.currency0)).transfer(msg.sender, amount0);
        if (amount1 != 0) DemoToken(Currency.unwrap(key.currency1)).transfer(msg.sender, amount1);
    }
}

contract DemoFeeOracle is INacreFeeValueOracle {
    address public immutable usdc;
    address public immutable weth;
    constructor(address usdc_, address weth_) { usdc = usdc_; weth = weth_; }
    function quote(address token, uint256 amount) external view returns (uint256) {
        if (token == usdc) return amount;
        if (token == weth) return amount * 2_689_500_000 / 1e18;
        revert("unsupported token");
    }
}
