// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {NacreCheckoutAccount, NacreCheckoutTerms} from "./NacreAtomicCheckout.sol";
import {NacrePolicyVault} from "./NacrePolicyVault.sol";
import {NacreLimitedOffer, NacreLimitedOfferFactory} from "./NacreLimitedOffers.sol";
import {NacreSwapVMMarket} from "./NacreSwapVMMarket.sol";
import {ISwapVM} from "../lib/swap-vm/contracts/interfaces/ISwapVM.sol";
import {TakerTraitsLib} from "../lib/swap-vm/contracts/libs/TakerTraits.sol";

/// @notice Exact-output SwapVM conversion, LP mint and coverage purchase, atomic.
/// Only nUSDC is pulled from the buyer. Existing policies and checkout are unchanged.
contract NacreSwapVMCheckout is ReentrancyGuard {
    using SafeERC20 for IERC20;
    NacreLimitedOfferFactory public immutable bidFactory;
    NacrePolicyVault public immutable vault;
    NacreSwapVMMarket public immutable market;
    mapping(address => address) public beneficiaries;
    event SuppliedAndProtected(address indexed buyer, address indexed account, uint256 indexed tokenId,
        uint256 requestId, address offer, uint256 premium);
    event SingleTokenSwap(address indexed buyer, bytes32 indexed orderHash, uint256 usdcSpent, uint256 assetReceived);

    constructor(NacreLimitedOfferFactory factory_, NacreSwapVMMarket market_) {
        require(address(factory_).code.length > 0 && address(market_).code.length > 0, "Invalid deployment");
        bidFactory = factory_; vault = factory_.app().vault(); market = market_;
        require(address(market_.usdc()) == address(vault.settlementToken()), "Wrong settlement token");
    }
    function _taker(uint256 maxInput, uint256 deadline) private view returns (bytes memory) {
        TakerTraitsLib.Args memory args;
        args.useTransferFromAndAquaPush = true;
        args.taker = address(this); args.threshold = abi.encode(maxInput);
        args.deadline = uint40(deadline);
        // Exact output, B -> A, no partial fill, no hooks or custom recipient.
        return TakerTraitsLib.build(args);
    }
    function quoteSwap(uint128 amountOut) external view returns (uint256 amountIn, bytes32 hash, uint40 expiry) {
        require(amountOut > 0 && market.available() >= amountOut, "Swap liquidity unavailable");
        ISwapVM.Order memory order = market.order();
        uint256 output;
        (amountIn, output, hash) = market.router().quote(order, amountOut, _taker(type(uint128).max, market.expiresAt()));
        require(output == amountOut, "Incomplete quote");
        expiry = market.expiresAt();
    }
    function supplyWithUSDC(NacreCheckoutTerms calldata p, uint256 maxSwapInput, bytes32 expectedOrderHash)
        external nonReentrant returns (address account, uint256 tokenId, uint256 requestId)
    {
        require(p.deadline > block.timestamp && p.deadline <= block.timestamp + 1 hours, "Invalid deadline");
        require(p.liquidity > 0 && p.amount0Max > 0 && p.amount1Max > 0 && p.feeCap > 0 && p.maxPremium > 0 && maxSwapInput > 0, "Invalid amounts");
        require(Currency.unwrap(p.key.currency0) == address(market.asset()) && Currency.unwrap(p.key.currency1) == address(market.usdc()), "Unsupported pair");
        require(bidFactory.offers(PoolId.unwrap(PoolIdLibrary.toId(p.key)), p.offerIndex) == p.offer, "Unknown bid");
        NacreLimitedOffer offer = NacreLimitedOffer(p.offer);
        require(offer.owner() != msg.sender, "Cannot buy own bid");
        require(p.tickLower >= offer.tickLower() && p.tickUpper <= offer.tickUpper() && p.tickLower < p.tickUpper, "Outside funded range");
        require(market.available() >= p.amount0Max, "Swap liquidity unavailable");
        require(expectedOrderHash == market.orderHash(), "Swap quote changed");
        IERC20 usdc = market.usdc(); IERC20 asset = market.asset();
        uint256 usdcBefore = usdc.balanceOf(address(this)); uint256 assetBefore = asset.balanceOf(address(this));
        uint256 total = uint256(p.amount1Max) + p.maxPremium + maxSwapInput;
        usdc.safeTransferFrom(msg.sender, address(this), total);
        require(usdc.balanceOf(address(this)) == usdcBefore + total, "Unsupported token transfer");
        ISwapVM router = market.router();
        usdc.forceApprove(address(router), maxSwapInput);
        uint256 deadline = p.deadline < market.expiresAt() ? p.deadline : market.expiresAt();
        (uint256 spent, uint256 received, bytes32 hash) = router.swap(market.order(), p.amount0Max, _taker(maxSwapInput, deadline));
        usdc.forceApprove(address(router), 0);
        require(hash == expectedOrderHash && received == p.amount0Max && spent <= maxSwapInput, "Invalid swap");
        require(asset.balanceOf(address(this)) == assetBefore + p.amount0Max, "Wrong swap output");
        require(usdc.balanceOf(address(this)) == usdcBefore + total - spent, "Wrong swap input");
        NacreCheckoutAccount buyer = new NacreCheckoutAccount(msg.sender, vault);
        account = address(buyer); beneficiaries[account] = msg.sender;
        asset.safeTransfer(account, p.amount0Max);
        usdc.safeTransfer(account, uint256(p.amount1Max) + p.maxPremium);
        uint256 premium;
        (tokenId, requestId, premium) = buyer.execute(p);
        // Only refund this purchase's surplus, never preexisting contract balances.
        uint256 refund = usdc.balanceOf(address(this)) - usdcBefore;
        if (refund > 0) usdc.safeTransfer(msg.sender, refund);
        emit SingleTokenSwap(msg.sender, hash, spent, received);
        emit SuppliedAndProtected(msg.sender, account, tokenId, requestId, p.offer, premium);
    }
}
