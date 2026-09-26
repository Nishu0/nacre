import { createPublicClient, http, parseAbi, encodeAbiParameters, keccak256, parseAbiParameters, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { COVERAGE_VAULT, COVERAGE_TOKEN, COVERAGE_POSITIONS,
  coverageVaultAbi, rangeFactoryAbi, rangeOfferAbi, coverageNftAbi, unpackTicks,
  type CoverageSnapshot, type CoverageOffer, type CoverageRequest } from "../../frontend/src/lib/coverage-contracts";

import { TEST_WETH_POOL, testPool, type TestPoolConfig } from "../../frontend/src/lib/test-pools";

const client = createPublicClient({ chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 10_000 }) });
import { CHECKOUTS, atomicCheckoutAbi } from "../../frontend/src/lib/atomic-checkout";
import { LIMITED_FACTORY, LIMITED_FACTORIES, limitedFactoryAbi, limitedOfferAbi } from "../../frontend/src/lib/limited-bids";
import { settlementBlock } from "./settlement-block";
const settlements = new Map<string, { value: NonNullable<CoverageRequest["settlement"]>; blockHash: string }>();

async function readSettlement(id: string, latest: bigint): Promise<NonNullable<CoverageRequest["settlement"]>> {
  const cached = settlements.get(id);
  if (cached && BigInt(cached.value.blockNumber) <= latest) {
    const block = await client.getBlock({ blockNumber: BigInt(cached.value.blockNumber) });
    if (block.hash === cached.blockHash) return cached.value;
    settlements.delete(id);
  }
  const blockNumber = await settlementBlock(latest, async (blockNumber) => {
    try {
      const row = await client.readContract({ address: COVERAGE_VAULT, abi: coverageVaultAbi, functionName: "requests", args: [BigInt(id)], blockNumber });
      return row[10] === 3;
    } catch (error) {
      // Historical probes can precede the vault's deployment. RPC errors still fail.
      const code = await client.getCode({ address: COVERAGE_VAULT, blockNumber });
      if (!code || code === "0x") return false;
      throw error;
    }
  });
  const logs = await client.getContractEvents({ address: COVERAGE_VAULT, abi: coverageVaultAbi,
    eventName: "Settled", args: { requestId: BigInt(id) }, fromBlock: blockNumber, toBlock: blockNumber, strict: true });
  const log = logs.find((event) => !event.removed && event.args.requestId === BigInt(id));
  if (!log || log.args.payout === undefined || log.args.eligibleFees === undefined || !log.transactionHash || !log.blockHash) throw new Error("Settlement receipt not available");
  const value = { payout: String(log.args.payout), eligibleFees: String(log.args.eligibleFees), transactionHash: log.transactionHash, blockNumber: String(blockNumber) };
  settlements.set(id, { value, blockHash: log.blockHash });
  return value;
}
const balanceAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const stateAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const pending = new Map<string, Promise<CoverageSnapshot>>();
const cached = new Map<string, { at: number; value: CoverageSnapshot }>();

export async function coverageSnapshot(tokenIds: string[], fresh = false, requestedPool?: string, registeredConfig?: TestPoolConfig): Promise<CoverageSnapshot> {
  // Archived pools remain available only through an explicit recovery lookup.
  if (!requestedPool) return coverageSnapshot(tokenIds, fresh, TEST_WETH_POOL);
  const config = registeredConfig ?? testPool(requestedPool);
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
    const checkoutIndices = new Map<string, number>();
    const limitedAddresses = (await Promise.all(LIMITED_FACTORIES.filter((factory) => BigInt(factory)).map(async (factory) => {
      const count = await client.readContract({ address: factory, abi: limitedFactoryAbi, functionName: "offerCount", args: [poolId], blockNumber });
      if (count > 1000n) throw new Error("Bid index requires pagination");
      const indexed = count ? await client.multicall({ allowFailure: false, blockNumber, contracts: Array.from({ length: Number(count) }, (_, i) => ({ address: factory, abi: limitedFactoryAbi, functionName: "offers" as const, args: [poolId, BigInt(i)] as const })) }) : [];
      if (factory.toLowerCase() === LIMITED_FACTORY.toLowerCase()) indexed.forEach((address, index) => checkoutIndices.set(address.toLowerCase(), index));
      return indexed;
    }))).flat();
    addresses.push(...limitedAddresses);
    const offers: CoverageOffer[] = await Promise.all(addresses.map(async (address) => {
      const values = await client.multicall({ allowFailure: false, blockNumber, contracts: [
        ...(["owner", "tickLower", "tickUpper", "duration", "premiumBps", "deposited", "withdrawn", "closed"] as const)
          .map((functionName) => ({ address, abi: rangeOfferAbi, functionName })),
        { address: COVERAGE_TOKEN, abi: balanceAbi, functionName: "balanceOf", args: [address] },
      ] });
      let limits: Partial<CoverageOffer> = {};
      if (limitedAddresses.includes(address)) {
        const [cap, max, remaining, rate, added, free] = await client.multicall({ allowFailure: false, blockNumber, contracts: (["capPerPosition", "maxSpots", "availableSpots", "currentPremiumBps", "addedCapital", "unreservedCapital"] as const).map((functionName) => ({ address, abi: limitedOfferAbi, functionName })) });
        const slots = await client.multicall({ allowFailure: false, blockNumber, contracts: Array.from({ length: Number(max) }, (_, i) => ({ address, abi: limitedOfferAbi, functionName: "slotRequests" as const, args: [BigInt(i)] as const })) });
        const ids = slots.filter((id) => id > 0n);
        const expiries = await client.multicall({ allowFailure: false, blockNumber, contracts: ids.map((id) => ({ address, abi: limitedOfferAbi, functionName: "reservationExpiry" as const, args: [id] as const })) });
        const premiums = await client.multicall({ allowFailure: false, blockNumber, contracts: ids.map((id) => ({ address, abi: limitedOfferAbi, functionName: "lockedPremium" as const, args: [id] as const })) });
        const [subranges] = await client.multicall({ blockNumber, contracts: [{ address, abi: limitedOfferAbi, functionName: "supportsSubranges" }] });
        limits = { supportsSubranges: subranges.status === "success" && subranges.result === true, lockedPremiums: Object.fromEntries(ids.map((id, i) => [String(id), String(premiums[i])])), capPerPosition: String(cap), maxSpots: Number(max), availableSpots: Number(remaining), unreservedCapital: String(free), premiumBps: Number(rate), deposited: String(BigInt(values[5] as bigint) + BigInt(added)), reservations: Object.fromEntries(ids.map((id, i) => [String(id), Number(expiries[i])])) };
      }
      return { poolId, address, checkoutIndex: checkoutIndices.get(address.toLowerCase()), owner: String(values[0]), tickLower: Number(values[1]), tickUpper: Number(values[2]),
        duration: Number(values[3]), premiumBps: Number(values[4]), deposited: String(values[5]),
        withdrawn: String(values[6]), closed: Boolean(values[7]), available: String(values[8]), ...limits };
    }));
    const rows = nextId > 1n ? await client.multicall({ allowFailure: false, blockNumber,
      contracts: Array.from({ length: Number(nextId - 1n) }, (_, i) => ({ address: COVERAGE_VAULT,
        abi: coverageVaultAbi, functionName: "requests" as const, args: [BigInt(i + 1)] as const })) }) : [];
    const lpAddresses = [...new Set(rows.map((row) => row[0]))];
    const beneficiaries = new Map<string, Address>();
    for (const checkout of CHECKOUTS) {
      const results = lpAddresses.length ? await client.multicall({ blockNumber,
        contracts: lpAddresses.map((address) => ({ address: checkout, abi: atomicCheckoutAbi, functionName: "beneficiaries" as const, args: [address] as const })) }) : [];
      results.forEach((result, index) => {
        if (result.status === "success" && BigInt(result.result)) beneficiaries.set(lpAddresses[index], result.result);
      });
    }
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
      lp: beneficiaries.get(row[0]) && BigInt(beneficiaries.get(row[0])!) ? beneficiaries.get(row[0])! : row[0],
      checkoutAccount: beneficiaries.get(row[0]) && BigInt(beneficiaries.get(row[0])!) ? row[0] : undefined, underwriter: row[1], tokenId: String(row[2]), feeFloor: String(row[3]),
      payoutCap: String(row[4]), premium: String(row[5]), quoteDeadline: Number(row[6]),
      startAt: Number(row[7]), endAt: Number(row[8]), duration: row[9], status: row[10],
      tickLower: positions.find((position) => position.tokenId === String(row[2]))!.tickLower,
      tickUpper: positions.find((position) => position.tokenId === String(row[2]))!.tickUpper,
    }));
    for (const request of requests.filter((row) => row.status === 3)) {
      try { request.settlement = await readSettlement(request.id, blockNumber); }
      catch { request.settlementError = "Could not verify the settlement receipt. Retry shortly."; }
    }
    const reserved = requests.filter((row) => row.status === 2).reduce((total, row) => total + BigInt(row.payoutCap), 0n);
    const value = { poolConfig: config, poolTicks: { [poolId]: slot[1] }, configured, blockNumber: String(blockNumber), currentTick: slot[1], offers,
      requests, positions, reserved: String(reserved) };
    cached.set(cacheKey, { at: Date.now(), value });
    for (const [key, row] of cached) if (Date.now() - row.at > 30_000) cached.delete(key);
    return value;
  })().finally(() => { pending.delete(cacheKey); });
  pending.set(cacheKey, operation);
  return operation;
}
