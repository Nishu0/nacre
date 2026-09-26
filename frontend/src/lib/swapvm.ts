import { parseAbi, type Address, type Hex } from "viem";
import deployment from "./swapvm-deployment.json";
export const SWAPVM_CHECKOUT = deployment.checkout as Address;
export const SWAPVM_ASSET = deployment.asset as Address;
export const swapVMAbi = parseAbi([
  "function quoteSwap(uint128 amountOut) view returns (uint256 amountIn,bytes32 hash,uint40 expiry)",
  "function supplyWithUSDC(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address offer,uint256 offerIndex,int24 tickLower,int24 tickUpper,uint128 liquidity,uint128 amount0Max,uint128 amount1Max,uint256 feeCap,uint256 maxPremium,uint256 deadline) p,uint256 maxSwapInput,bytes32 expectedOrderHash) returns (address account,uint256 tokenId,uint256 requestId)",
]);
export type SingleTokenQuote = { amountIn: string; maxInput: string; orderHash: Hex; expiresAt: number; amountOut: string };
export function swapInputLimit(input: bigint) {
  if (input <= 0n) throw new Error("Swap quote must be positive.");
  return (input * 10050n + 9999n) / 10000n; // 0.5% maximum input buffer, refunded if unused.
}
