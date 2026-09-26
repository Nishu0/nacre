// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface INacreClaimToken is IERC20 {
    function FAUCET_AMOUNT() external view returns (uint256);
    function claim() external;
}

/// @notice Repeatable faucet for the existing Base Sepolia nUSDC token.
/// @dev The deployed token restricts each caller to one claim. Each request
///      deploys a fresh one-use caller and forwards its 10,000 nUSDC to the user.
contract NacreRepeatFaucet {
    INacreClaimToken public immutable token;
    uint256 public immutable amount;

    event Claimed(address indexed recipient, address indexed oneUseCaller, uint256 amount);

    constructor(INacreClaimToken token_) {
        require(address(token_).code.length > 0, "token has no code");
        token = token_;
        amount = token_.FAUCET_AMOUNT();
        require(amount > 0, "zero faucet amount");
    }

    function claim() external {
        NacreOneUseClaim caller = new NacreOneUseClaim(token, msg.sender, amount);
        emit Claimed(msg.sender, address(caller), amount);
    }
}

/// @dev Has no callable runtime functions. Its constructor consumes one claim
///      from the original token, then transfers the freshly minted tokens.
contract NacreOneUseClaim {
    using SafeERC20 for IERC20;

    constructor(INacreClaimToken token, address recipient, uint256 amount) {
        token.claim();
        IERC20(address(token)).safeTransfer(recipient, amount);
    }
}
