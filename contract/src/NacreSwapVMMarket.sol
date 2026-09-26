// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "../lib/swap-vm/contracts/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "../lib/swap-vm/contracts/libs/MakerTraits.sol";
import {StaticBalances} from "../lib/swap-vm/contracts/instructions/Balances.sol";
import {LimitSwap} from "../lib/swap-vm/contracts/instructions/LimitSwap.sol";
import {Salt, Deadline} from "../lib/swap-vm/contracts/instructions/Controls.sol";

/// @notice A separately funded, one-direction nUSDC -> nWETH maker. Coverage
/// collateral is never used for swaps. Prices are maker quotes, not oracle prices.
contract NacreSwapVMMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable owner;
    IAqua public immutable aqua;
    ISwapVM public immutable router;
    IERC20 public immutable asset;
    IERC20 public immutable usdc;
    uint64 public sequence;
    uint40 public expiresAt;
    bytes32 public orderHash;
    ISwapVM.Order private currentOrder;
    event QuotePublished(bytes32 indexed orderHash, uint256 inventory, uint256 usdcPerAsset, uint40 expiresAt);

    constructor(IAqua aqua_, ISwapVM router_, IERC20 asset_, IERC20 usdc_) {
        require(address(asset_) < address(usdc_), "Unsupported token order");
        owner = msg.sender; aqua = aqua_; router = router_; asset = asset_; usdc = usdc_;
    }
    function order() external view returns (ISwapVM.Order memory) { return currentOrder; }
    function available() external view returns (uint256) {
        if (block.timestamp >= expiresAt) return 0;
        (uint248 allocated, uint8 count) = aqua.rawBalances(address(this), address(router), orderHash, address(asset));
        if (count == 0 || count == type(uint8).max) return 0;
        uint256 balance = asset.balanceOf(address(this));
        return balance < allocated ? balance : allocated;
    }
    /// @param inventory Amount of 18-decimal asset supplied by the maker.
    /// @param usdcPerAsset Price in 6-decimal nUSDC per whole asset.
    function fundQuote(uint128 inventory, uint128 usdcPerAsset, uint40 expiry) external nonReentrant {
        require(msg.sender == owner, "Only maker");
        require(inventory > 0 && usdcPerAsset > 0 && expiry > block.timestamp && expiry <= block.timestamp + 1 days, "Invalid quote");
        _dock();
        asset.safeTransferFrom(msg.sender, address(this), inventory);
        uint256 balance = asset.balanceOf(address(this));
        asset.forceApprove(address(aqua), balance);
        MakerTraitsLib.Args memory args;
        args.maker = address(this); args.tokenA = address(asset); args.tokenB = address(usdc);
        args.useAquaInsteadOfSignature = true;
        // Fixed maker rate, sufficient virtual balances for all funded inventory.
        args.program = bytes.concat(Salt.build(++sequence), Deadline.build(expiry),
            StaticBalances.build(balance, (balance * usdcPerAsset + 1 ether - 1) / 1 ether),
            LimitSwap.build(address(usdc), address(asset)));
        currentOrder = MakerTraitsLib.build(args);
        address[] memory tokens = _tokens();
        uint256[] memory amounts = new uint256[](2); amounts[0] = balance;
        orderHash = aqua.ship(address(router), abi.encode(currentOrder), tokens, amounts);
        expiresAt = expiry;
        emit QuotePublished(orderHash, balance, usdcPerAsset, expiry);
    }
    function close() external nonReentrant {
        require(msg.sender == owner, "Only maker");
        _dock(); expiresAt = 0;
        asset.forceApprove(address(aqua), 0);
        asset.safeTransfer(owner, asset.balanceOf(address(this)));
        usdc.safeTransfer(owner, usdc.balanceOf(address(this)));
    }
    function _dock() private {
        if (orderHash != bytes32(0)) aqua.dock(address(router), orderHash, _tokens());
    }
    function _tokens() private view returns (address[] memory tokens) {
        tokens = new address[](2); tokens[0] = address(asset); tokens[1] = address(usdc);
    }
}
