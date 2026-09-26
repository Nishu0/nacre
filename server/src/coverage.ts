import { createPublicClient, http, parseAbi, encodeAbiParameters, keccak256, parseAbiParameters } from "viem";
import { baseSepolia } from "viem/chains";
import { COVERAGE_VAULT, COVERAGE_TOKEN, COVERAGE_POSITIONS,
  coverageVaultAbi, rangeFactoryAbi, rangeOfferAbi, coverageNftAbi, unpackTicks,
  type CoverageSnapshot, type CoverageOffer, type CoverageRequest } from "../../frontend/src/lib/coverage-contracts";

import { TEST_WETH_POOL, testPool } from "../../frontend/src/lib/test-pools";

const client = createPublicClient({ chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 10_000 }) });
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const stateAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const pending = new Map<string, Promise<CoverageSnapshot>>();
const cached = new Map<string, { at: number; value: CoverageSnapshot }>();

export async function coverageSnapshot(tokenIds: string[], fresh = false, requestedPool?: string): Promise<CoverageSnapshot> {
  // Archived pools remain available only through an explicit recovery lookup.
  if (!requestedPool) return coverageSnapshot(tokenIds, fresh, TEST_WETH_POOL);
  const config = testPool(requestedPool);
  if (!config) throw new Error("Unknown coverage pool");
  const poolId = config.poolId;
  const RANGE_FACTORY = config.factory;
  const cacheKey = poolId + ":" + [...tokenIds].sort().join(",");
  const previous = cached.get(cacheKey);
  if (!fresh && previous && Date.now() - previous.at < 5000) return previous.value;
  const running = pending.get(cacheKey);
  if (running) return running;
  const operation = (async () => {
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const configured = BigInt(RANGE_FACTORY) !== 0n;
    const [nextId, slot, count] = await Promise.all([
      client.readContract({ address: COVERAGE_VAULT, abi: coverageVaultAbi, functionName: "nextRequestId", blockNumber }),
      client.readContract({ address: "0x571291b572ed32ce6751a2cb2486ebee8defb9b4", abi: stateAbi, functionName: "getSlot0", args: [poolId], blockNumber }),
      configured ? client.readContract({ address: RANGE_FACTORY, abi: rangeFactoryAbi, functionName: "offerCount", blockNumber }) : 0n,
    ]);
    if (nextId > 1001n || count > 1000n) throw new Error("Coverage index requires pagination");
    const addresses = count ? await client.multicall({ allowFailure: false, blockNumber,
      contracts: Array.from({ length: Number(count) }, (_, i) => ({ address: RANGE_FACTORY,
        abi: rangeFactoryAbi, functionName: "offers" as const, args: [BigInt(i)] as const })) }) : [];
    const offers: CoverageOffer[] = await Promise.all(addresses.map(async (address) => {
      const values = await client.multicall({ allowFailure: false, blockNumber, contracts: [
        ...(["owner", "tickLower", "tickUpper", "duration", "premiumBps", "deposited", "withdrawn", "closed"] as const)
          .map((functionName) => ({ address, abi: rangeOfferAbi, functionName })),
        { address: COVERAGE_TOKEN, abi: balanceAbi, functionName: "balanceOf", args: [address] },
      ] });
      return { poolId, address, owner: String(values[0]), tickLower: Number(values[1]), tickUpper: Number(values[2]),
        duration: Number(values[3]), premiumBps: Number(values[4]), deposited: String(values[5]),
        withdrawn: String(values[6]), closed: Boolean(values[7]), available: String(values[8]) };
    }));
    const rows = nextId > 1n ? await client.multicall({ allowFailure: false, blockNumber,
      contracts: Array.from({ length: Number(nextId - 1n) }, (_, i) => ({ address: COVERAGE_VAULT,
        abi: coverageVaultAbi, functionName: "requests" as const, args: [BigInt(i + 1)] as const })) }) : [];
    const ids = [...new Set([...tokenIds, ...rows.map((row) => String(row[2]))])];
    const positionRows = await Promise.all(ids.map(async (id) => {
      const [owner, info] = await Promise.all([
        client.readContract({ address: COVERAGE_POSITIONS, abi: coverageNftAbi, functionName: "ownerOf", args: [BigInt(id)], blockNumber }),
        client.readContract({ address: COVERAGE_POSITIONS, abi: coverageNftAbi, functionName: "getPoolAndPositionInfo", args: [BigInt(id)], blockNumber }),
      ]);
      const poolId = keccak256(encodeAbiParameters(parseAbiParameters(
        "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"), [info[0]]));
      return { tokenId: id, owner, poolId, ...unpackTicks(info[1]) };
    }));
    const positions = positionRows.filter((position) => position.poolId === poolId);
    const requests: CoverageRequest[] = rows.map((row, index) => ({ row, id: String(index + 1) }))
      .filter(({ row }) => positions.some((position) => position.tokenId === String(row[2])))
      .map(({ row, id }) => ({ poolId, id,
      lp: row[0], underwriter: row[1], tokenId: String(row[2]), feeFloor: String(row[3]),
      payoutCap: String(row[4]), premium: String(row[5]), quoteDeadline: Number(row[6]),
      startAt: Number(row[7]), endAt: Number(row[8]), duration: row[9], status: row[10],
      tickLower: positions.find((position) => position.tokenId === String(row[2]))!.tickLower,
      tickUpper: positions.find((position) => position.tokenId === String(row[2]))!.tickUpper,
    }));
    const reserved = requests.filter((row) => row.status === 2).reduce((total, row) => total + BigInt(row.payoutCap), 0n);
    const value = { poolTicks: { [poolId]: slot[1] }, configured, blockNumber: String(blockNumber), currentTick: slot[1], offers,
      requests, positions, reserved: String(reserved) };
    cached.set(cacheKey, { at: Date.now(), value });
    for (const [key, row] of cached) if (Date.now() - row.at > 30_000) cached.delete(key);
    return value;
  })().finally(() => { pending.delete(cacheKey); });
  pending.set(cacheKey, operation);
  return operation;
}
