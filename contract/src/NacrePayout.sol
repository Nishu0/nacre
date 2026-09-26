// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice The capped fee-floor payout used by a Nacre policy.
/// @dev All three inputs must use the same settlement-token denomination and decimals.
contract NacrePayout {
    function calculatePayout(uint256 feeFloor, uint256 eligibleFees, uint256 payoutCap)
        external
        pure
        returns (uint256)
    {
        if (eligibleFees >= feeFloor) return 0;

        uint256 shortfall = feeFloor - eligibleFees;
        return shortfall < payoutCap ? shortfall : payoutCap;
    }
}
