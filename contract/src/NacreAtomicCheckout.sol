// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {NacrePolicyVault} from "./NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "./NacreAquaUnderwriter.sol";
import {NacreLimitedOffer, NacreLimitedOfferFactory} from "./NacreLimitedOffers.sol";

interface ICheckoutPermit2 { function approve(address token, address spender, uint160 amount, uint48 expiration) external; }
interface ICheckoutPositions { function nextTokenId() external view returns (uint256); }

struct NacreCheckoutTerms {
    PoolKey key;
    address offer;
    uint256 offerIndex;
    int24 tickLower;
    int24 tickUpper;
    uint128 liquidity;
    uint128 amount0Max;
    uint128 amount1Max;
    uint256 feeCap;
    uint256 maxPremium;
    uint256 deadline;
}

/// @notice One immutable beneficiary account per atomic purchase. Existing vault
/// and Aqua contracts see this account as the LP. Settlement automatically forwards
/// the NFT, fees and payout to the buying wallet; no admin can change that wallet.
contract NacreCheckoutAccount is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable beneficiary;
    address public immutable checkout;
    address public settlementRecipient;
    NacrePolicyVault public immutable vault;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    IERC20 public token0;
    IERC20 public token1;
    uint256 public tokenId;
    uint256 public requestId;
    bool public executed;

    constructor(address beneficiary_, NacrePolicyVault vault_) {
        beneficiary = beneficiary_; settlementRecipient = beneficiary_; vault = vault_; checkout = msg.sender;
    }

    function execute(NacreCheckoutTerms calldata p) external nonReentrant returns (uint256, uint256, uint256) {
        require(msg.sender == checkout && !executed, "Only checkout once");
        executed = true;
        token0 = IERC20(Currency.unwrap(p.key.currency0));
        token1 = IERC20(Currency.unwrap(p.key.currency1));
        address positions = address(vault.positionManager());
        _approveMint(token0, positions, p.amount0Max, p.deadline);
        _approveMint(token1, positions, p.amount1Max, p.deadline);
        tokenId = ICheckoutPositions(positions).nextTokenId();
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(p.key, p.tickLower, p.tickUpper, uint256(p.liquidity),
            p.amount0Max, p.amount1Max, address(this), bytes(""));
        params[1] = abi.encode(p.key.currency0, p.key.currency1);
        vault.positionManager().modifyLiquidities(abi.encode(hex"020d", params), p.deadline);
        require(vault.positionManager().ownerOf(tokenId) == address(this), "Wrong NFT");
        _approveMint(token0, positions, 0, p.deadline);
        _approveMint(token1, positions, 0, p.deadline);
        vault.positionManager().approve(address(vault), tokenId);
        NacreLimitedOffer offer = NacreLimitedOffer(p.offer);
        requestId = vault.createRequest(p.key, tokenId, p.feeCap, p.feeCap, offer.duration(), uint64(p.deadline));
        offer.publish(requestId);
        NacreAquaUnderwriter.Quote memory quote = offer.quoteFor(requestId);
        require(quote.premium <= p.maxPremium, "Premium increased");
        NacreAquaUnderwriter app = offer.app();
        vault.settlementToken().forceApprove(address(app), quote.premium);
        app.buyCoverage(quote);
        vault.settlementToken().forceApprove(address(app), 0);
        (, , , NacrePolicyVault.Status status) = vault.requestTerms(requestId);
        require(status == NacrePolicyVault.Status.Active, "Coverage not active");
        _refund(beneficiary);
        return (tokenId, requestId, quote.premium);
    }

    function _approveMint(IERC20 token, address positions, uint128 amount, uint256 deadline) private {
        token.forceApprove(PERMIT2, amount);
        ICheckoutPermit2(PERMIT2).approve(address(token), positions, amount, uint48(deadline));
    }

    /// @notice A contract wallet that rejects NFTs may select its own recovery
    /// recipient. Only the original buying wallet has this permission.
    function setSettlementRecipient(address recipient) external nonReentrant {
        require(msg.sender == beneficiary, "Only beneficiary");
        require(recipient != address(0) && recipient != address(this) && recipient != address(vault), "Invalid recipient");
        settlementRecipient = recipient;
    }

    function _refund(address recipient) private {
        uint256 a = token0.balanceOf(address(this));
        uint256 b = token1.balanceOf(address(this));
        if (a != 0) token0.safeTransfer(recipient, a);
        if (b != 0) token1.safeTransfer(recipient, b);
    }

    // The vault transfers the NFT last, after paying fees and any payout.
    // This callback forwards everything even if a third party calls vault.settle.
    function onERC721Received(address, address from, uint256 id, bytes calldata) external nonReentrant returns (bytes4) {
        require(msg.sender == address(vault.positionManager()) && from == address(vault)
            && executed && id == tokenId, "Unexpected NFT");
        (, , , NacrePolicyVault.Status status) = vault.requestTerms(requestId);
        require(status == NacrePolicyVault.Status.Settled, "Policy not settled");
        _refund(settlementRecipient);
        vault.positionManager().safeTransferFrom(address(this), settlementRecipient, id);
        return IERC721Receiver.onERC721Received.selector;
    }
}

/// @notice Permissionless atomic checkout for offers from one trusted factory.
/// No custody of existing positions, no arbitrary targets and no upgrade/admin path.
contract NacreAtomicCheckout is ReentrancyGuard {
    using SafeERC20 for IERC20;
    NacreLimitedOfferFactory public immutable bidFactory;
    NacrePolicyVault public immutable vault;
    mapping(address => address) public beneficiaries;
    event SuppliedAndProtected(address indexed buyer, address indexed account, uint256 indexed tokenId,
        uint256 requestId, address offer, uint256 premium);

    constructor(NacreLimitedOfferFactory factory_) {
        require(address(factory_).code.length > 0, "Invalid factory");
        bidFactory = factory_; vault = factory_.app().vault();
    }

    function supplyAndProtect(NacreCheckoutTerms calldata p) external nonReentrant returns (address account, uint256 tokenId, uint256 requestId) {
        require(p.deadline > block.timestamp && p.deadline <= block.timestamp + 1 hours, "Invalid deadline");
        require(p.liquidity > 0 && p.amount0Max > 0 && p.amount1Max > 0 && p.feeCap > 0 && p.maxPremium > 0, "Invalid amounts");
        bytes32 poolId = PoolId.unwrap(PoolIdLibrary.toId(p.key));
        require(bidFactory.offers(poolId, p.offerIndex) == p.offer, "Unknown bid");
        NacreLimitedOffer offer = NacreLimitedOffer(p.offer);
        require(offer.owner() != msg.sender, "Cannot buy own bid");
        require(p.tickLower >= offer.tickLower() && p.tickUpper <= offer.tickUpper()
            && p.tickLower < p.tickUpper, "Outside funded range");
        require(Currency.unwrap(p.key.currency0) != address(0) && Currency.unwrap(p.key.currency1) == address(vault.settlementToken()), "Unsupported pair");
        NacreCheckoutAccount buyerAccount = new NacreCheckoutAccount(msg.sender, vault);
        account = address(buyerAccount);
        beneficiaries[account] = msg.sender;
        _fund(IERC20(Currency.unwrap(p.key.currency0)), account, p.amount0Max);
        _fund(vault.settlementToken(), account, uint256(p.amount1Max) + p.maxPremium);
        uint256 premium;
        (tokenId, requestId, premium) = buyerAccount.execute(p);
        emit SuppliedAndProtected(msg.sender, account, tokenId, requestId, p.offer, premium);
    }

    function _fund(IERC20 token, address account, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(account);
        token.safeTransferFrom(msg.sender, account, amount);
        require(token.balanceOf(account) - beforeBalance == amount, "Unsupported token transfer");
    }
}
