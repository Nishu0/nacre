// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {NacrePolicyVault} from "./NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "./NacreAquaUnderwriter.sol";

interface IPositionLiquidity { function getPositionLiquidity(uint256 tokenId) external view returns (uint128); }

/// @notice A maker-owned, funded offer for exact pool ticks and coverage duration.
/// @dev Filled caps move to the existing policy vault via Aqua. Premiums and
/// settlement refunds belong to this offer's owner, never to another offer.
contract NacreRangeOffer is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PositionInfoLibrary for PositionInfo;
    address public immutable owner;
    NacreAquaUnderwriter public immutable app;
    NacrePolicyVault public immutable vault;
    IERC20 public immutable token;
    IAqua public immutable aqua;
    bytes32 public immutable poolId;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;
    uint32 public immutable duration;
    uint16 public immutable premiumBps;
    uint256 public immutable deposited;
    uint256 public withdrawn;
    uint256 public constant MAX_FEE_APR_BPS = 2000;
    bool public closed;
    mapping(uint256 => bool) public published;

    event Published(uint256 indexed requestId, bytes32 strategyHash, uint256 premium);
    event Withdrawn(address indexed owner, uint256 amount);

    constructor(address owner_, NacreAquaUnderwriter app_, bytes32 poolId_, int24 lower_,
        int24 upper_, uint32 duration_, uint16 premiumBps_, uint256 amount_)
    {
        owner = owner_;
        app = app_;
        vault = app_.vault();
        token = app_.settlementToken();
        aqua = app_.AQUA();
        poolId = poolId_;
        tickLower = lower_;
        tickUpper = upper_;
        duration = duration_;
        premiumBps = premiumBps_;
        deposited = amount_;
    }

    /// @notice Conservative fee ceiling independent of manipulable DEX spot.
    /// Value the two endpoint inventories with the configured fee oracle and
    /// use the lower value, then cap fees at 20% annualized for this duration.
    function maximumCap(uint256 tokenId) public view virtual returns (uint256) {
        (PoolKey memory key, uint256 packed) = vault.positionManager().getPoolAndPositionInfo(tokenId);
        PositionInfo info = PositionInfo.wrap(packed);
        uint128 liquidity = IPositionLiquidity(address(vault.positionManager())).getPositionLiquidity(tokenId);
        uint160 lower = TickMath.getSqrtPriceAtTick(info.tickLower());
        uint160 upper = TickMath.getSqrtPriceAtTick(info.tickUpper());
        uint256 amount0 = SqrtPriceMath.getAmount0Delta(lower, upper, liquidity, false);
        uint256 amount1 = SqrtPriceMath.getAmount1Delta(lower, upper, liquidity, false);
        if (amount0 == 0 || amount1 == 0) return 0;
        uint256 value0 = vault.feeValueOracle().quote(Currency.unwrap(key.currency0), amount0);
        uint256 value1 = vault.feeValueOracle().quote(Currency.unwrap(key.currency1), amount1);
        uint256 principal = value0 < value1 ? value0 : value1;
        return principal * MAX_FEE_APR_BPS * duration / (10000 * 365 days);
    }

    function _matchesRange(int24 lower, int24 upper) internal view virtual returns (bool) {
        return lower == tickLower && upper == tickUpper;
    }

    function quoteFor(uint256 requestId) public view virtual returns (NacreAquaUnderwriter.Quote memory q) {
        require(!closed, "Offer closed");
        (bool ok, bytes memory data) = address(vault).staticcall(
            abi.encodeWithSelector(vault.requests.selector, requestId));
        require(ok, "Request unavailable");
        NacrePolicyVault.Request memory r = abi.decode(data, (NacrePolicyVault.Request));
        require(r.status == NacrePolicyVault.Status.Open && r.lp != owner, "Request not eligible");
        require(r.duration == duration && r.quoteDeadline > block.timestamp, "Duration or expiry mismatch");
        require(PoolId.unwrap(PoolIdLibrary.toId(vault.poolKey(requestId))) == poolId, "Wrong pool");
        (, uint256 packed) = vault.positionManager().getPoolAndPositionInfo(r.tokenId);
        PositionInfo info = PositionInfo.wrap(packed);
        require(_matchesRange(info.tickLower(), info.tickUpper()), "Different bins");
        require(vault.isInRange(requestId), "Position out of range");
        require(r.feeFloor == r.payoutCap && r.payoutCap <= maximumCap(r.tokenId), "Fee target exceeds position limit");
        require(token.balanceOf(address(this)) >= r.payoutCap, "Capacity exhausted");
        q = NacreAquaUnderwriter.Quote({maker: address(this), requestId: requestId,
            premium: (r.payoutCap * premiumBps + 9999) / 10000, payoutCap: r.payoutCap,
            expiresAt: r.quoteDeadline, salt: bytes32(requestId)});
    }

    /// @notice Anyone, including the buying LP, can prepare a matching offer.
    function publish(uint256 requestId) public virtual nonReentrant {
        NacreAquaUnderwriter.Quote memory q = quoteFor(requestId);
        // Exact current balance, never an unlimited allowance. The real balance
        // is also checked atomically by Aqua, so concurrent fills cannot reuse it.
        token.forceApprove(address(aqua), token.balanceOf(address(this)));
        if (published[requestId]) return;
        published[requestId] = true;
        address[] memory tokens = new address[](1);
        tokens[0] = address(token);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = q.payoutCap;
        bytes32 hash = aqua.ship(address(app), abi.encode(q), tokens, amounts);
        emit Published(requestId, hash, q.premium);
    }

    /// @notice Close unfilled offers and withdraw available capital/premiums.
    /// Active caps stay isolated in the policy vault. Call again after settlement
    /// to withdraw the refunded balance; closing never impairs existing cover.
    function closeAndWithdraw() external nonReentrant {
        require(msg.sender == owner, "Only owner");
        closed = true;
        token.forceApprove(address(aqua), 0);
        uint256 amount = token.balanceOf(address(this));
        withdrawn += amount;
        token.safeTransfer(owner, amount);
        emit Withdrawn(owner, amount);
    }
}

contract NacreRangeOfferFactory is ReentrancyGuard {
    using SafeERC20 for IERC20;
    NacreAquaUnderwriter public immutable app;
    bytes32 public immutable poolId;
    address[] public offers;
    event OfferCreated(address indexed offer, address indexed owner, uint256 amount,
        int24 tickLower, int24 tickUpper, uint32 duration, uint16 premiumBps);

    constructor(NacreAquaUnderwriter app_, bytes32 poolId_) {
        require(address(app_).code.length > 0 && poolId_ != bytes32(0), "Invalid configuration");
        app = app_;
        poolId = poolId_;
    }

    function offerCount() external view returns (uint256) { return offers.length; }

    function createOffer(uint256 amount, int24 lower, int24 upper, uint32 duration, uint16 premiumBps)
        external nonReentrant returns (address offer)
    {
        require(amount > 0 && amount <= type(uint128).max, "Invalid amount");
        require(lower < upper && lower >= -887270 && upper <= 887270
            && lower % 10 == 0 && upper % 10 == 0, "Invalid bins");
        require(duration >= 1 days && duration <= 90 days, "Invalid duration");
        require(premiumBps > 0 && premiumBps <= 10000, "Invalid premium");
        offer = address(new NacreRangeOffer(msg.sender, app, poolId, lower, upper, duration, premiumBps, amount));
        IERC20 token = app.settlementToken();
        uint256 beforeBalance = token.balanceOf(offer);
        token.safeTransferFrom(msg.sender, offer, amount);
        require(token.balanceOf(offer) - beforeBalance == amount, "Unsupported token transfer");
        offers.push(offer);
        emit OfferCreated(offer, msg.sender, amount, lower, upper, duration, premiumBps);
    }
}
