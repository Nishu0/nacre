import { parseAbi } from "viem";

export const COVERAGE_VAULT = "0x879ead283e76afc12865ca43a0a3f10c3626cce0" as const;
export const COVERAGE_APP = "0x0d2ed632e5a10ab713d183369687720d4e3817cd" as const;
export const COVERAGE_TOKEN = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8" as const;
export const COVERAGE_POSITIONS = "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80" as const;
export const COVERAGE_POOL = "0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56" as const;
export const RANGE_FACTORY: `0x${string}` = "0x6b9803efd7f39163af2ceb330ee58afbadd06751";
const key = "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const quote = "(address maker,uint256 requestId,uint256 premium,uint256 payoutCap,uint64 expiresAt,bytes32 salt)";
export const coverageVaultAbi = parseAbi([
  "function nextRequestId() view returns (uint256)",
  "function reservedCollateral() view returns (uint256)",
  "function requests(uint256) view returns (address lp,address underwriter,uint256 tokenId,uint256 feeFloor,uint256 payoutCap,uint256 premium,uint64 quoteDeadline,uint64 startAt,uint64 endAt,uint32 duration,uint8 status)",
  `function poolKey(uint256) view returns (${key})`,
  `function createRequest(${key} key,uint256 tokenId,uint256 feeFloor,uint256 payoutCap,uint32 duration,uint64 quoteDeadline) returns (uint256)`,
  "function isInRange(uint256) view returns (bool)",
  "function cancel(uint256)",
  "function settle(uint256) returns (uint256)",
  "event Requested(uint256 indexed requestId,address indexed lp,uint256 indexed tokenId,uint256 feeFloor,uint256 payoutCap,uint64 quoteDeadline)",
  "event Settled(uint256 indexed requestId,uint256 eligibleFees,uint256 payout,uint256 fee0,uint256 fee1)",
]);
export const rangeFactoryAbi = parseAbi([
  "function offerCount() view returns (uint256)",
  "function offers(uint256) view returns (address)",
  "function createOffer(uint256 amount,int24 lower,int24 upper,uint32 duration,uint16 premiumBps) returns (address)",
  "event OfferCreated(address indexed offer,address indexed owner,uint256 amount,int24 tickLower,int24 tickUpper,uint32 duration,uint16 premiumBps)",
]);
export const rangeOfferAbi = parseAbi([
  "function owner() view returns (address)", "function tickLower() view returns (int24)",
  "function tickUpper() view returns (int24)", "function duration() view returns (uint32)",
  "function premiumBps() view returns (uint16)", "function deposited() view returns (uint256)",
  "function withdrawn() view returns (uint256)", "function closed() view returns (bool)",
  `function quoteFor(uint256) view returns (${quote})`,
  "function maximumCap(uint256) view returns (uint256)",
  "function publish(uint256)", "function closeAndWithdraw()",
]);
export const coverageAppAbi = parseAbi([
  `function canFill(${quote}) view returns (bool)`, `function buyCoverage(${quote})`,
]);
export const coverageNftAbi = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function getApproved(uint256) view returns (address)", "function approve(address,uint256)",
  `function getPoolAndPositionInfo(uint256) view returns (${key} poolKey,uint256 info)`,
]);
export type CoverageOffer = {
  poolId: string;
  address: `0x${string}`; owner: string; tickLower: number; tickUpper: number;
  duration: number; premiumBps: number; deposited: string; withdrawn: string;
  available: string; closed: boolean;
};
export type CoverageRequest = {
  poolId: string;
  id: string; lp: string; underwriter: string; tokenId: string; feeFloor: string;
  payoutCap: string; premium: string; quoteDeadline: number; startAt: number;
  endAt: number; duration: number; status: number; tickLower: number; tickUpper: number;
};
export type CoveragePosition = { poolId: string; tokenId: string; owner: string; tickLower: number; tickUpper: number };
export type CoverageSnapshot = {
  poolTicks: Record<string, number>;
  configured: boolean; blockNumber: string; currentTick: number; offers: CoverageOffer[];
  requests: CoverageRequest[]; positions: CoveragePosition[]; reserved: string;
};
export function unpackTicks(info: bigint) {
  const signed = (value: bigint) => Number(BigInt.asIntN(24, value));
  return { tickLower: signed((info >> BigInt(8)) & BigInt(0xffffff)),
    tickUpper: signed((info >> BigInt(32)) & BigInt(0xffffff)) };
}
export const tickPrice = (tick: number) => Math.pow(1.0001, tick) * 1e12;
