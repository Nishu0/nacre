// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice BASE SEPOLIA DEMO ONLY. Synthetic fee input, real test-token transfers.
/// @dev Does not read historical prices, own an LP NFT, or settle a Nacre policy.
contract NacreIllustrativeSettlement is ReentrancyGuard {
    using SafeERC20 for IERC20;
    enum Stage { Created, Funded, Purchased, Settled, Cancelled }
    IERC20 public immutable token;
    address public immutable underwriter;
    address public immutable investor;
    bytes32 public immutable scenarioHash;
    uint256 public constant feeTarget = 10e6;
    uint256 public constant illustrativeFees = 8.6e6;
    uint256 public constant premium = 1.8e6;
    uint256 public constant payout = 1.4e6;
    uint256 public constant refund = 8.6e6;
    bool public constant illustrative = true;
    Stage public stage;
    uint256 public purchaseBlock;
    uint256 public settlementBlock;
    event DemoFunded(address indexed underwriter, uint256 amount);
    event DemoPremiumPaid(address indexed investor, address indexed underwriter, uint256 amount);
    event IllustrativeSettlement(bytes32 indexed scenarioHash, uint256 simulatedFees,
        uint256 actualPayout, uint256 collateralReturned);

    constructor(IERC20 token_, address investor_, bytes32 scenarioHash_) {
        require(block.chainid == 84532, "Base Sepolia only");
        require(address(token_) != address(0) && investor_ != address(0)
            && investor_ != msg.sender && scenarioHash_ != bytes32(0), "Invalid demo terms");
        token = token_; investor = investor_; underwriter = msg.sender; scenarioHash = scenarioHash_;
    }
    function fund() external nonReentrant {
        require(msg.sender == underwriter && stage == Stage.Created, "Cannot fund");
        stage = Stage.Funded;
        token.safeTransferFrom(msg.sender, address(this), feeTarget);
        emit DemoFunded(msg.sender, feeTarget);
    }
    function purchase() external nonReentrant {
        require(msg.sender == investor && stage == Stage.Funded, "Cannot purchase");
        stage = Stage.Purchased;
        purchaseBlock = block.number;
        token.safeTransferFrom(msg.sender, underwriter, premium);
        emit DemoPremiumPaid(msg.sender, underwriter, premium);
    }
    /// Anyone can execute the disclosed synthetic scenario after both wallets consent.
    function settle() external nonReentrant {
        require(stage == Stage.Purchased, "Cannot settle");
        stage = Stage.Settled;
        settlementBlock = block.number;
        token.safeTransfer(investor, payout);
        token.safeTransfer(underwriter, refund);
        emit IllustrativeSettlement(scenarioHash, illustrativeFees, payout, refund);
    }
    function cancel() external nonReentrant {
        require(msg.sender == underwriter && (stage == Stage.Created || stage == Stage.Funded), "Cannot cancel");
        stage = Stage.Cancelled;
        token.safeTransfer(underwriter, token.balanceOf(address(this)));
    }
}
