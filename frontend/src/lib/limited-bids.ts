import { parseAbi, type Address } from "viem";
import deployment from "./bid-tools-deployment.json";
export const LIMITED_FACTORY = deployment.limitedFactory as Address;
// Keep old funded offers indexed; their immutable terms remain exact-range.
export const LIMITED_FACTORIES = [...new Set([LIMITED_FACTORY, ...((deployment as { legacyLimitedFactories?: string[] }).legacyLimitedFactories ?? [])])] as Address[];
export const TEST_SWAP_BATCH = deployment.swapBatch as Address;
export const limitedFactoryAbi = parseAbi([
  "function supportsSubranges() pure returns (bool)",
  "function offerCount(bytes32) view returns (uint256)",
  "function offers(bytes32,uint256) view returns (address)",
  "function createOffers((uint24 fee,uint256 amount,int24 lower,int24 upper,uint32 duration,uint16 premiumBps,uint256 cap,uint16 spots)[] bids) returns (address[])",
]);
export const limitedOfferAbi = parseAbi([
  "function supportsSubranges() pure returns (bool)",
  "function capPerPosition() view returns (uint256)", "function maxSpots() view returns (uint16)",
  "function availableSpots() view returns (uint16)", "function currentPremiumBps() view returns (uint16)",
  "function addedCapital() view returns (uint256)", "function unreservedCapital() view returns (uint256)",
  "function lockedPremium(uint256) view returns (uint256)",
  "function slotRequests(uint256) view returns (uint256)", "function reservationExpiry(uint256) view returns (uint64)",
  "function topUp(uint256 amount,uint16 extraSpots)", "function setPremiumBps(uint16 premiumBps)",
]);
