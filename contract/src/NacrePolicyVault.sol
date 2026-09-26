// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PositionInfo, PositionInfoLibrary} from "@uniswap/v4-periphery/src/libraries/PositionInfoLibrary.sol";
import {NacreFeeHook} from "./NacreFeeHook.sol";

interface INacrePositionManager is IERC721 {
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface INacreFeeValueOracle {
    /// @notice Value token-denominated fees in the settlement token's smallest units.
    function quote(address token, uint256 tokenAmount) external view returns (uint256);
}

/// @notice One fully collateralized 30-day fee-floor policy per escrowed v4 NFT.
/// @dev Research prototype. The oracle must be configured with manipulation-resistant
///      prices and token decimals before any real value is deposited.
contract NacrePolicyVault is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    using PositionInfoLibrary for PositionInfo;

    enum Status { None, Open, Active, Settled, Cancelled }

    struct Request {
        address lp;
        address underwriter;
        uint256 tokenId;
        uint256 feeFloor;
        uint256 payoutCap;
        uint256 premium;
        uint64 quoteDeadline;
        uint64 startAt;
        uint64 endAt;
        uint32 duration;
        Status status;
    }

    error InvalidTerms();
    error InvalidPosition();
    error InvalidStatus();
    error NotAuthorized();
    error TooEarly();
    error InsufficientCollateral();
    error UnsupportedNativeCurrency();
    error OutOfRange();

    IERC20 public immutable settlementToken;
    INacrePositionManager public immutable positionManager;
    INacreFeeValueOracle public immutable feeValueOracle;
    NacreFeeHook public immutable feeHook;
    address public aquaApp;
    address public immutable appSetter;
    uint256 public nextRequestId = 1;
    uint256 public reservedCollateral;
    uint256 private expectedDepositRequestId;

    mapping(uint256 => Request) public requests;
    mapping(uint256 => PoolKey) private requestPoolKeys;

    event Requested(uint256 indexed requestId, address indexed lp, uint256 indexed tokenId,
        uint256 feeFloor, uint256 payoutCap, uint64 quoteDeadline);
    event Activated(uint256 indexed requestId, address indexed underwriter, uint256 premium, uint64 endAt);
    event Settled(uint256 indexed requestId, uint256 eligibleFees, uint256 payout,
        uint256 fee0, uint256 fee1);
    event Cancelled(uint256 indexed requestId);

    constructor(IERC20 settlementToken_, INacrePositionManager positionManager_,
        INacreFeeValueOracle oracle_, NacreFeeHook hook_)
    {
        if (address(settlementToken_) == address(0) || address(positionManager_) == address(0)
            || address(oracle_) == address(0) || address(hook_) == address(0)) {
            revert InvalidTerms();
        }
        settlementToken = settlementToken_;
        positionManager = positionManager_;
        feeValueOracle = oracle_;
        feeHook = hook_;
        appSetter = msg.sender;
    }

    function setAquaApp(address app_) external {
        if (msg.sender != appSetter || aquaApp != address(0) || app_ == address(0)) revert NotAuthorized();
        aquaApp = app_;
    }

    function createRequest(PoolKey calldata key, uint256 tokenId, uint256 feeFloor,
        uint256 payoutCap, uint32 duration, uint64 quoteDeadline)
        external nonReentrant returns (uint256 requestId)
    {
        if (feeFloor == 0 || payoutCap == 0 || payoutCap > feeFloor || duration == 0
            || duration > 90 days || quoteDeadline <= block.timestamp
            || quoteDeadline > block.timestamp + 30 days) revert InvalidTerms();
        if (address(key.hooks) != address(feeHook)) revert InvalidPosition();
        if (Currency.unwrap(key.currency0) == address(0) || Currency.unwrap(key.currency1) == address(0)) {
            revert UnsupportedNativeCurrency();
        }
        (PoolKey memory actual, uint256 packedInfo) = positionManager.getPoolAndPositionInfo(tokenId);
        if (PoolId.unwrap(PoolIdLibrary.toId(actual)) != PoolId.unwrap(key.toId())
            || positionManager.ownerOf(tokenId) != msg.sender) {
            revert InvalidPosition();
        }
        _requireInRange(key, packedInfo);

        requestId = nextRequestId++;
        requests[requestId] = Request({
            lp: msg.sender, underwriter: address(0), tokenId: tokenId,
            feeFloor: feeFloor, payoutCap: payoutCap, premium: 0,
            quoteDeadline: quoteDeadline, startAt: 0, endAt: 0,
            duration: duration, status: Status.Open
        });
        requestPoolKeys[requestId] = key;
        expectedDepositRequestId = requestId;
        positionManager.safeTransferFrom(msg.sender, address(this), tokenId);
        expectedDepositRequestId = 0;
        emit Requested(requestId, msg.sender, tokenId, feeFloor, payoutCap, quoteDeadline);
    }

    function requestTerms(uint256 requestId)
        external view returns (address lp, uint256 payoutCap, uint64 quoteDeadline, Status status)
    {
        Request memory request = requests[requestId];
        return (request.lp, request.payoutCap, request.quoteDeadline, request.status);
    }

    function poolKey(uint256 requestId) external view returns (PoolKey memory) {
        return requestPoolKeys[requestId];
    }

    function isInRange(uint256 requestId) external view returns (bool) {
        Request storage request = requests[requestId];
        if (request.status != Status.Open) return false;
        (, uint256 packedInfo) = positionManager.getPoolAndPositionInfo(request.tokenId);
        return _inRange(requestPoolKeys[requestId], packedInfo);
    }

    /// @dev Called only after the Aqua app pulls the full payout cap into this vault.
    function activate(uint256 requestId, address underwriter, uint256 premium)
        external nonReentrant
    {
        if (msg.sender != aquaApp) revert NotAuthorized();
        Request storage request = requests[requestId];
        if (request.status != Status.Open) revert InvalidStatus();
        if (block.timestamp > request.quoteDeadline) revert TooEarly();
        if (underwriter == address(0) || underwriter == request.lp || premium == 0) revert InvalidTerms();
        if (settlementToken.balanceOf(address(this)) < reservedCollateral + request.payoutCap) {
            revert InsufficientCollateral();
        }

        PoolKey memory key = requestPoolKeys[requestId];
        (, uint256 packedInfo) = positionManager.getPoolAndPositionInfo(request.tokenId);
        _requireInRange(key, packedInfo);
        // Crystallize pre-policy fees before the hook begins recording. The NFT
        // is already held here; an LP cannot withhold the expiry collection.
        (uint256 old0, uint256 old1) = _collect(request.tokenId, key);
        _forwardFees(request.lp, key, old0, old1);

        request.underwriter = underwriter;
        request.premium = premium;
        request.startAt = uint64(block.timestamp);
        request.endAt = uint64(block.timestamp + request.duration);
        request.status = Status.Active;
        reservedCollateral += request.payoutCap;
        if (feeHook.controller() == address(this)) feeHook.startCoverage(key, request.tokenId);
        emit Activated(requestId, underwriter, premium, request.endAt);
    }

    function cancel(uint256 requestId) external nonReentrant {
        Request storage request = requests[requestId];
        if (request.status != Status.Open) revert InvalidStatus();
        if (msg.sender != request.lp) revert NotAuthorized();
        if (block.timestamp <= request.quoteDeadline) revert TooEarly();
        request.status = Status.Cancelled;
        positionManager.safeTransferFrom(address(this), request.lp, request.tokenId);
        emit Cancelled(requestId);
    }

    /// @notice Anyone can settle an expired policy; no trusted keeper is needed.
    function settle(uint256 requestId) external nonReentrant returns (uint256 payout) {
        Request storage request = requests[requestId];
        if (request.status != Status.Active) revert InvalidStatus();
        if (block.timestamp < request.endAt) revert TooEarly();
        PoolKey memory key = requestPoolKeys[requestId];
        (uint256 amount0, uint256 amount1) = _collect(request.tokenId, key);
        // NFT custody is authoritative: only this vault can collect or change
        // its position. A pool with a previously bound hook controller remains
        // usable; when we control the hook, also check its accounting ledger.
        if (feeHook.controller() == address(this)) {
            (uint256 recorded0, uint256 recorded1) = feeHook.feeTotals(key, request.tokenId);
            if (recorded0 != amount0 || recorded1 != amount1) revert InvalidPosition();
        }

        uint256 eligibleFees = (amount0 == 0 ? 0 : feeValueOracle.quote(Currency.unwrap(key.currency0), amount0))
            + (amount1 == 0 ? 0 : feeValueOracle.quote(Currency.unwrap(key.currency1), amount1));
        uint256 shortfall = eligibleFees >= request.feeFloor ? 0 : request.feeFloor - eligibleFees;
        payout = shortfall < request.payoutCap ? shortfall : request.payoutCap;

        request.status = Status.Settled;
        reservedCollateral -= request.payoutCap;
        if (feeHook.controller() == address(this)) feeHook.stopCoverage(key, request.tokenId);
        _forwardFees(request.lp, key, amount0, amount1);
        if (payout != 0) settlementToken.safeTransfer(request.lp, payout);
        settlementToken.safeTransfer(request.underwriter, request.payoutCap - payout);
        positionManager.safeTransferFrom(address(this), request.lp, request.tokenId);
        emit Settled(requestId, eligibleFees, payout, amount0, amount1);
    }

    function _collect(uint256 tokenId, PoolKey memory key) internal returns (uint256 amount0, uint256 amount1) {
        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        uint256 before0 = IERC20(currency0).balanceOf(address(this));
        uint256 before1 = IERC20(currency1).balanceOf(address(this));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(tokenId, uint256(0), uint128(0), uint128(0), bytes(""));
        params[1] = abi.encode(key.currency0, key.currency1, address(this));
        // PositionManager Actions.DECREASE_LIQUIDITY (0x01), TAKE_PAIR (0x11).
        positionManager.modifyLiquidities(abi.encode(hex"0111", params), block.timestamp);
        amount0 = IERC20(currency0).balanceOf(address(this)) - before0;
        amount1 = IERC20(currency1).balanceOf(address(this)) - before1;
    }

    function _forwardFees(address lp, PoolKey memory key, uint256 amount0, uint256 amount1) internal {
        if (amount0 != 0) IERC20(Currency.unwrap(key.currency0)).safeTransfer(lp, amount0);
        if (amount1 != 0) IERC20(Currency.unwrap(key.currency1)).safeTransfer(lp, amount1);
    }

    function _requireInRange(PoolKey memory key, uint256 packedInfo) internal view {
        if (!_inRange(key, packedInfo)) revert OutOfRange();
    }

    function _inRange(PoolKey memory key, uint256 packedInfo) internal view returns (bool) {
        PositionInfo info = PositionInfo.wrap(packedInfo);
        (, int24 tick,,) = feeHook.poolManager().getSlot0(key.toId());
        return tick >= info.tickLower() && tick < info.tickUpper();
    }

    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external view returns (bytes4)
    {
        Request storage expected = requests[expectedDepositRequestId];
        if (msg.sender != address(positionManager) || expectedDepositRequestId == 0
            || expected.lp != from || expected.tokenId != tokenId) revert InvalidPosition();
        return IERC721Receiver.onERC721Received.selector;
    }
}
