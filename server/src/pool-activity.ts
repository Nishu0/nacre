import { createPublicClient, http, parseAbi, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { TEST_SWAP_BATCH } from "../../frontend/src/lib/limited-bids";
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });
const manager = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408";
const state = "0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4";
const stateAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)"]);
const swapEvent = parseAbi(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"])[0];
const modifyEvent = parseAbi(["event ModifyLiquidity(bytes32 indexed id,address indexed sender,int24 tickLower,int24 tickUpper,int256 liquidityDelta,bytes32 salt)"])[0];
export type PoolActivity = { poolId: string; price: number; tvl: number; feePct: number; swaps: number; syntheticSwaps: number; grossFees: number; syntheticFees: number; organicFees: number; baseApr: number | null; organicApr: number | null; hours: number; low: number; high: number; capturedAt: string; methodology: string };
const cache = new Map<string, { at: number; result: PoolActivity }>();
const pending = new Map<string, Promise<PoolActivity>>();
export async function poolActivity(poolId: Hex, creationTx: Hex): Promise<PoolActivity> {
  const prior = cache.get(poolId); if (prior && Date.now() - prior.at < 30000) return prior.result;
  if (pending.has(poolId)) return pending.get(poolId)!;
  const operation = (async () => {
    const [receipt, latest, slot] = await Promise.all([client.getTransactionReceipt({ hash: creationTx }), client.getBlock(), client.readContract({ address: state, abi: stateAbi, functionName: "getSlot0", args: [poolId] })]);
    const origin = await client.getBlock({ blockNumber: receipt.blockNumber });
    // Base blocks are roughly two seconds. Read one extra hour, then use actual block timestamps.
    const cutoff = latest.timestamp > 86400n ? latest.timestamp - 86400n : 0n;
    const recentBlock = latest.number > 45000n ? latest.number - 45000n : 0n;
    const ranges = new Map<string, { lower: number; upper: number; liquidity: bigint }>();
    const swaps: Awaited<ReturnType<typeof client.getLogs>> = [];
    for (let from = receipt.blockNumber; from <= latest.number; from += 1000n) {
      const to = from + 999n < latest.number ? from + 999n : latest.number;
      const changes = await client.getLogs({ address: manager, event: modifyEvent, args: { id: poolId }, fromBlock: from, toBlock: to });
      for (const log of changes) {
        const a = log.args; if (a.tickLower === undefined || a.tickUpper === undefined || a.liquidityDelta === undefined) continue;
        const key = `${a.sender}:${a.tickLower}:${a.tickUpper}:${a.salt}`;
        const row = ranges.get(key) ?? { lower: a.tickLower, upper: a.tickUpper, liquidity: 0n };
        row.liquidity += a.liquidityDelta; ranges.set(key, row);
      }
      if (to >= recentBlock) swaps.push(...await client.getLogs({ address: manager, event: swapEvent, args: { id: poolId }, fromBlock: from > recentBlock ? from : recentBlock, toBlock: to }));
    }
    const p = Number(slot[0]) / 2 ** 96, price = p * p * 1e12;
    let tvl = 0;
    for (const range of ranges.values()) {
      const a = 1.0001 ** (range.lower / 2), b = 1.0001 ** (range.upper / 2), x = Math.max(a, Math.min(b, p)), l = Number(range.liquidity);
      if (l > 0) tvl += l * (b - x) / (x * b) / 1e18 * price + l * (x - a) / 1e6;
    }
    let grossFees = 0, syntheticFees = 0, count = 0, syntheticSwaps = 0, low = price, high = price;
    const timestamps = new Map<bigint, bigint>();
    // Decode only typed swap events; timestamps distinguish the rolling window precisely.
    const { decodeEventLog } = await import("viem");
    for (const log of swaps) {
      if (!log.blockNumber) continue;
      let time = timestamps.get(log.blockNumber);
      if (!time) { time = (await client.getBlock({ blockNumber: log.blockNumber })).timestamp; timestamps.set(log.blockNumber, time); }
      if (time < cutoff) continue;
      const { args } = decodeEventLog({ abi: [swapEvent], data: log.data, topics: log.topics });
      const spot = (Number(args.sqrtPriceX96) / 2 ** 96) ** 2 * 1e12;
      const input = args.amount0 < 0n ? -Number(args.amount0) / 1e18 * spot : -Number(args.amount1) / 1e6;
      const fees = input * args.fee / 1e6;
      grossFees += fees; count++; low = Math.min(low, spot); high = Math.max(high, spot);
      if (args.sender.toLowerCase() === TEST_SWAP_BATCH.toLowerCase()) { syntheticFees += fees; syntheticSwaps++; }
    }
    const hours = Math.min(24, Number(latest.timestamp - origin.timestamp) / 3600);
    const annualize = (fees: number) => tvl > 0 && hours > 0 ? fees / tvl * 8760 / hours * 100 : null;
    const result = { poolId, price, tvl, feePct: slot[3] / 10000, swaps: count, syntheticSwaps, grossFees, syntheticFees, organicFees: grossFees - syntheticFees, baseApr: annualize(grossFees), organicApr: annualize(grossFees - syntheticFees), hours, low, high, capturedAt: new Date().toISOString(), methodology: "Rolling 24h (or pool age) swap inputs × actual swap fee / current LP inventory value, annualized. Gross fee estimate before protocol share; TVL reconstructed from all liquidity changes since initialization, excluding accrued fees. nUSDC treated as one unit. Synthetic router activity is separated. This run rate is not a forecast or realized position APR." };
    cache.set(poolId, { at: Date.now(), result }); return result;
  })().finally(() => pending.delete(poolId));
  pending.set(poolId, operation); return operation;
}
