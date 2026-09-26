// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {NacreRangeOffer} from "./NacreRangeOffers.sol";
import {NacreAquaUnderwriter} from "./NacreAquaUnderwriter.sol";
import {NacrePolicyVault} from "./NacrePolicyVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
interface ILimitedPoolState { function getSlot0(bytes32) external view returns (uint160,int24,uint24,uint24); }

/// Slots reserve on publish, before Aqua fill. Active slots only reopen after settlement.
contract NacreLimitedOffer is NacreRangeOffer {
    using SafeERC20 for IERC20;
    uint256 public immutable capPerPosition;
    uint16 public maxSpots;
    uint16 public currentPremiumBps;
    uint256 public addedCapital;
    uint256[] public slotRequests;
    mapping(uint256 => uint256) public lockedPremium;
    mapping(uint256 => uint64) public reservationExpiry;
    event ToppedUp(uint256 amount, uint16 addedSpots);
    event PremiumUpdated(uint16 premiumBps);
    constructor(address owner_, NacreAquaUnderwriter app_, bytes32 pool_, int24 lower_, int24 upper_,
        uint32 duration_, uint16 rate_, uint256 amount_, uint256 cap_, uint16 spots_)
        NacreRangeOffer(owner_, app_, pool_, lower_, upper_, duration_, rate_, amount_) {
        capPerPosition = cap_; maxSpots = spots_; currentPremiumBps = rate_;
        slotRequests = new uint256[](spots_);
    }
    function _terms(uint256 id) internal view returns (NacrePolicyVault.Request memory r) {
        (bool ok, bytes memory data) = address(vault).staticcall(abi.encodeWithSelector(vault.requests.selector, id));
        require(ok, "Request unavailable"); return abi.decode(data, (NacrePolicyVault.Request));
    }
    function _occupied(uint256 id) internal view returns (bool) {
        if (id == 0) return false;
        NacrePolicyVault.Request memory r = _terms(id);
        // Strict > expiry matters: Aqua permits filling AT the quote deadline.
        return (r.status == NacrePolicyVault.Status.Open && block.timestamp <= reservationExpiry[id])
            || (r.status == NacrePolicyVault.Status.Active && r.underwriter == address(this));
    }
    function availableSpots() public view returns (uint16 remaining) {
        if (closed) return 0;
        for (uint256 i; i < slotRequests.length; ++i) if (!_occupied(slotRequests[i])) ++remaining;
    }
    function unreservedCapital() public view returns (uint256) {
        uint256 reserved;
        for (uint256 i; i < slotRequests.length; ++i) {
            uint256 id = slotRequests[i];
            if (id == 0) continue;
            NacrePolicyVault.Request memory r = _terms(id);
            if (r.status == NacrePolicyVault.Status.Open && block.timestamp <= reservationExpiry[id]) reserved += r.payoutCap;
        }
        uint256 balance = token.balanceOf(address(this));
        return balance > reserved ? balance - reserved : 0;
    }
    function maximumCap(uint256 tokenId) public view override returns (uint256) {
        uint256 ceiling = super.maximumCap(tokenId);
        return ceiling < capPerPosition ? ceiling : capPerPosition;
    }
    function quoteFor(uint256 requestId) public view override returns (NacreAquaUnderwriter.Quote memory q) {
        q = super.quoteFor(requestId);
        bool reserved = published[requestId] && block.timestamp <= reservationExpiry[requestId];
        if (!reserved) {
            require(availableSpots() > 0, "No spots remaining");
            require(unreservedCapital() >= q.payoutCap, "Capital reserved for other buyers");
        }
        q.expiresAt = reserved ? reservationExpiry[requestId] : uint64(block.timestamp + 15 minutes);
        uint64 deadline = _terms(requestId).quoteDeadline;
        if (q.expiresAt > deadline) q.expiresAt = deadline;
        q.premium = reserved ? lockedPremium[requestId] : (q.payoutCap * currentPremiumBps + 9999) / 10000;
    }
    function publish(uint256 requestId) public override nonReentrant {
        NacreAquaUnderwriter.Quote memory q = quoteFor(requestId);
        token.forceApprove(address(aqua), token.balanceOf(address(this)));
        if (published[requestId] && block.timestamp <= reservationExpiry[requestId]) return;
        // Only the buyer or offer owner can reserve a spot for an escrowed NFT.
        require(msg.sender == _terms(requestId).lp || msg.sender == owner, "Only buyer or owner");
        // Remove an expired occurrence before choosing a new free slot.
        for (uint256 i; i < slotRequests.length; ++i) if (slotRequests[i] == requestId) slotRequests[i] = 0;
        bool found;
        for (uint256 i; i < slotRequests.length; ++i) if (!_occupied(slotRequests[i])) {
            slotRequests[i] = requestId; found = true; break;
        }
        require(found, "No spots remaining");
        published[requestId] = true; lockedPremium[requestId] = q.premium; reservationExpiry[requestId] = q.expiresAt;
        address[] memory tokens = new address[](1); tokens[0] = address(token);
        uint256[] memory amounts = new uint256[](1); amounts[0] = q.payoutCap;
        bytes32 hash = aqua.ship(address(app), abi.encode(q), tokens, amounts);
        emit Published(requestId, hash, q.premium);
    }
    function topUp(uint256 amount, uint16 extraSpots) external nonReentrant {
        require(msg.sender == owner && !closed, "Only open offer owner");
        require(amount > 0 && amount <= type(uint128).max && uint256(maxSpots) + extraSpots <= 100, "Invalid top up");
        require(amount >= uint256(extraSpots) * capPerPosition, "Back each additional spot");
        addedCapital += amount; maxSpots += extraSpots;
        for (uint256 i; i < extraSpots; ++i) slotRequests.push(0);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        require(token.balanceOf(address(this)) - beforeBalance == amount, "Unsupported token");
        emit ToppedUp(amount, extraSpots);
    }
    function setPremiumBps(uint16 rate) external {
        require(msg.sender == owner && !closed, "Only open offer owner");
        require(rate > 0 && rate <= 10000, "Invalid premium");
        currentPremiumBps = rate; emit PremiumUpdated(rate);
    }
}
contract NacreLimitedOfferFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    NacreAquaUnderwriter public immutable app;
    mapping(bytes32 => address[]) public offers;
    struct Bid { uint24 fee; uint256 amount; int24 lower; int24 upper; uint32 duration; uint16 premiumBps; uint256 cap; uint16 spots; }
    event LimitedOfferCreated(bytes32 indexed poolId, address indexed offer, address indexed owner, uint256 amount, uint256 cap, uint16 spots);
    constructor(NacreAquaUnderwriter app_) { require(address(app_).code.length > 0, "Invalid app"); app = app_; }
    function offerCount(bytes32 poolId) external view returns (uint256) { return offers[poolId].length; }
    function createOffers(Bid[] calldata bids) external nonReentrant returns (address[] memory created) {
        require(bids.length > 0 && bids.length <= 4, "One to four bids");
        created = new address[](bids.length);
        for (uint256 i; i < bids.length; ++i) created[i] = _create(bids[i]);
    }
    function _create(Bid calldata b) private returns (address offer) {
        require(b.amount > 0 && b.amount <= type(uint128).max && b.cap > 0 && b.cap <= b.amount, "Invalid capital");
        require(b.spots > 0 && b.spots <= 100 && b.amount >= b.cap * b.spots, "Back every spot");
        require(b.lower < b.upper && b.lower >= -887270 && b.upper <= 887270 && b.lower % 10 == 0 && b.upper % 10 == 0, "Invalid bins");
        require(b.duration >= 1 days && b.duration <= 90 days && b.premiumBps > 0 && b.premiumBps <= 10000, "Invalid terms");
        PoolKey memory key = PoolKey(Currency.wrap(0x3333C20E21Eeaed85766232B20641d56fd3788c4), Currency.wrap(0xfa35D165b03B8eB193934D338Db8de536e84AAC8), b.fee, 10, IHooks(0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00));
        bytes32 poolId = PoolId.unwrap(PoolIdLibrary.toId(key));
        (uint160 price,,,) = ILimitedPoolState(0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4).getSlot0(poolId);
        require(price > 0, "Pool not initialized");
        offer = address(new NacreLimitedOffer(msg.sender, app, poolId, b.lower, b.upper, b.duration, b.premiumBps, b.amount, b.cap, b.spots));
        uint256 beforeBalance = app.settlementToken().balanceOf(offer);
        app.settlementToken().safeTransferFrom(msg.sender, offer, b.amount);
        require(app.settlementToken().balanceOf(offer) - beforeBalance == b.amount, "Unsupported token");
        offers[poolId].push(offer);
        emit LimitedOfferCreated(poolId, offer, msg.sender, b.amount, b.cap, b.spots);
    }
}
