// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NacreChainlinkFeeOracle, IAggregatorV3} from "../src/NacreChainlinkFeeOracle.sol";

contract DecimalToken is ERC20 {
    uint8 internal immutable tokenDecimals;
    constructor(string memory symbol_, uint8 decimals_) ERC20(symbol_, symbol_) { tokenDecimals = decimals_; }
    function decimals() public view override returns (uint8) { return tokenDecimals; }
}

contract MockAggregator is IAggregatorV3 {
    int256 public answer;
    uint256 public updatedAt;
    constructor(int256 answer_) { answer = answer_; updatedAt = block.timestamp; }
    function decimals() external pure returns (uint8) { return 8; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
    function setAnswer(int256 answer_) external { answer = answer_; updatedAt = block.timestamp; }
}

contract NacreChainlinkFeeOracleTest is Test {
    DecimalToken internal usdc;
    DecimalToken internal weth;
    MockAggregator internal feed;
    NacreChainlinkFeeOracle internal oracle;

    function setUp() public {
        usdc = new DecimalToken("USDC", 6);
        weth = new DecimalToken("WETH", 18);
        feed = new MockAggregator(2_000e8);
        oracle = new NacreChainlinkFeeOracle(address(usdc), 1 hours);
        oracle.configureFeed(address(weth), feed);
    }

    function testConvertsBothFeeCurrenciesToUsdcUnits() public view {
        assertEq(oracle.quote(address(usdc), 500e6), 500e6);
        assertEq(oracle.quote(address(weth), 1e18), 2_000e6);
    }

    function testRejectsStaleAndNonpositiveFeed() public {
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(NacreChainlinkFeeOracle.StalePrice.selector);
        oracle.quote(address(weth), 1e18);
        feed.setAnswer(0);
        vm.expectRevert(NacreChainlinkFeeOracle.StalePrice.selector);
        oracle.quote(address(weth), 1e18);
    }

    function testFeedBindingCannotBeChanged() public {
        vm.expectRevert(NacreChainlinkFeeOracle.InvalidFeed.selector);
        oracle.configureFeed(address(weth), feed);
    }
}
