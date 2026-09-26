// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {INacreFeeValueOracle} from "./NacrePolicyVault.sol";

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
    );
}

/// @notice Converts collected pool-token fees to USDC units using USD feeds.
/// @dev Feed bindings are one-time so accepted policies cannot be repriced by
///      an administrator changing an oracle address mid-coverage.
contract NacreChainlinkFeeOracle is INacreFeeValueOracle {
    error OnlyOwner();
    error InvalidFeed();
    error StalePrice();
    error UnsupportedToken();

    address public immutable owner;
    address public immutable settlementToken;
    uint256 public immutable maxAge;
    mapping(address => IAggregatorV3) public feedFor;

    event FeedConfigured(address indexed token, address indexed feed);

    constructor(address settlementToken_, uint256 maxAge_) {
        if (settlementToken_ == address(0) || maxAge_ == 0
            || IERC20Metadata(settlementToken_).decimals() != 6) revert InvalidFeed();
        owner = msg.sender;
        settlementToken = settlementToken_;
        maxAge = maxAge_;
    }

    function configureFeed(address token, IAggregatorV3 feed) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (token == address(0) || token == settlementToken || address(feed) == address(0)
            || address(feedFor[token]) != address(0)) revert InvalidFeed();
        uint8 tokenDecimals = IERC20Metadata(token).decimals();
        uint8 feedDecimals = feed.decimals();
        if (tokenDecimals > 24 || feedDecimals > 24) revert InvalidFeed();
        feedFor[token] = feed;
        emit FeedConfigured(token, address(feed));
    }

    function quote(address token, uint256 amount) external view returns (uint256) {
        if (token == settlementToken) return amount;
        IAggregatorV3 feed = feedFor[token];
        if (address(feed) == address(0)) revert UnsupportedToken();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp
            || block.timestamp - updatedAt > maxAge || answeredInRound < roundId) revert StalePrice();
        uint256 denominator = 10 ** uint256(IERC20Metadata(token).decimals())
            * 10 ** uint256(feed.decimals());
        return Math.mulDiv(amount, uint256(answer) * 1e6, denominator);
    }
}
