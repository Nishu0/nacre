import { decodeEventLog, parseAbi, type Address, type Hex } from "viem";
import { SWAPVM_CHECKOUT } from "./swapvm";
import deployment from "./atomic-checkout-deployment.json";

export const ATOMIC_CHECKOUT = deployment.checkout as Address;
export const CHECKOUTS = [ATOMIC_CHECKOUT, SWAPVM_CHECKOUT].filter((address) => BigInt(address) !== 0n);
export const atomicCheckoutAbi = parseAbi([
  "function beneficiaries(address) view returns (address)",
  "function bidFactory() view returns (address)",
  "function supplyAndProtect(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,address offer,uint256 offerIndex,int24 tickLower,int24 tickUpper,uint128 liquidity,uint128 amount0Max,uint128 amount1Max,uint256 feeCap,uint256 maxPremium,uint256 deadline) p) returns (address account,uint256 tokenId,uint256 requestId)",
  "event SuppliedAndProtected(address indexed buyer,address indexed account,uint256 indexed tokenId,uint256 requestId,address offer,uint256 premium)",
]);
export function atomicPurchase(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], buyer: string, checkout?: Address) {
  const allowed = checkout ? [checkout] : CHECKOUTS;
  for (const log of logs) {
    if (!allowed.some((address) => BigInt(address) !== 0n && log.address.toLowerCase() === address.toLowerCase())) continue;
    try {
      const event = decodeEventLog({ abi: atomicCheckoutAbi, eventName: "SuppliedAndProtected", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (event.args.buyer.toLowerCase() === buyer.toLowerCase()) return event.args;
    } catch { /* Only a verified checkout event can attribute an escrowed mint. */ }
  }
  return null;
}
