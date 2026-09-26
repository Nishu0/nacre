// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {AquaApp} from "@1inch/aqua/src/AquaApp.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NacrePolicyVault} from "./NacrePolicyVault.sol";

/// @notice Aqua app for collateral-backed fee-floor underwriting quotes.
/// @dev Makers ship abi.encode(Quote) to the official Aqua registry. Unfilled
///      quotes keep virtual balances; the winning cap is pulled into the vault.
contract NacreAquaUnderwriter is AquaApp, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Quote {
        address maker;
        uint256 requestId;
        uint256 premium;
        uint256 payoutCap;
        uint64 expiresAt;
        bytes32 salt;
    }

    error InvalidQuote();
    error WrongBuyer();
    error QuoteExpired();
    error InsufficientAquaBalance();

    NacrePolicyVault public immutable vault;
    IERC20 public immutable settlementToken;

    event QuoteFilled(bytes32 indexed strategyHash, uint256 indexed requestId,
        address indexed maker, address lp, uint256 premium, uint256 payoutCap);

    constructor(IAqua aqua_, NacrePolicyVault vault_) AquaApp(aqua_) {
        require(address(aqua_) != address(0) && address(vault_) != address(0), "zero address");
        vault = vault_;
        settlementToken = vault_.settlementToken();
    }

    function strategyHash(Quote calldata quote) external pure returns (bytes32) {
        return keccak256(abi.encode(quote));
    }

    /// @notice Current fillability for an all-or-nothing underwriting quote.
    /// @dev Aqua balances are virtual. Both the maker's wallet balance and its
    ///      allowance to Aqua may change after this view call; buyCoverage
    ///      remains the authoritative atomic check.
    function canFill(Quote calldata quote) external view returns (bool) {
        (address lp, uint256 cap, uint64 deadline, NacrePolicyVault.Status status) =
            vault.requestTerms(quote.requestId);
        if (status != NacrePolicyVault.Status.Open || quote.maker == address(0)
            || quote.maker == lp || quote.payoutCap != cap || quote.premium == 0
            || block.timestamp > quote.expiresAt || quote.expiresAt > deadline) return false;

        bytes32 hash = keccak256(abi.encode(quote));
        (uint248 available, uint8 tokenCount) =
            AQUA.rawBalances(quote.maker, address(this), hash, address(settlementToken));
        return tokenCount != 0 && tokenCount != type(uint8).max && available >= cap
            && settlementToken.balanceOf(quote.maker) >= cap
            && settlementToken.allowance(quote.maker, address(AQUA)) >= cap;
    }

    function buyCoverage(Quote calldata quote) external nonReentrant {
        (address lp, uint256 cap, uint64 deadline, NacrePolicyVault.Status status) =
            vault.requestTerms(quote.requestId);
        if (status != NacrePolicyVault.Status.Open || quote.maker == address(0)
            || quote.maker == lp || quote.payoutCap != cap || quote.premium == 0) revert InvalidQuote();
        if (msg.sender != lp) revert WrongBuyer();
        if (block.timestamp > quote.expiresAt || quote.expiresAt > deadline) revert QuoteExpired();

        bytes32 hash = keccak256(abi.encode(quote));
        (uint248 available, uint8 tokenCount) =
            AQUA.rawBalances(quote.maker, address(this), hash, address(settlementToken));
        if (tokenCount == 0 || tokenCount == type(uint8).max || available < cap) {
            revert InsufficientAquaBalance();
        }

        // Aqua.pull performs the real token transfer. The full payout cap is
        // isolated before policy activation, so no live cover shares collateral.
        AQUA.pull(quote.maker, hash, address(settlementToken), cap, address(vault));
        settlementToken.safeTransferFrom(lp, quote.maker, quote.premium);
        vault.activate(quote.requestId, quote.maker, quote.premium);
        emit QuoteFilled(hash, quote.requestId, quote.maker, lp, quote.premium, cap);
    }
}
