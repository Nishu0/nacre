import type { Database } from "bun:sqlite";
import { createPublicClient, decodeEventLog, http, type Hex, type TransactionReceipt } from "viem";
import { baseSepolia } from "viem/chains";
import { openPoolAbi, openPoolId, openPoolDeploymentData, OPEN_POOL_MANAGER, poolInitializeAbi } from "../../frontend/src/lib/open-pool";
import { getMarket, presentMarket, priceToTick, VALID_REFERENCE } from "./market-model";
const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { timeout: 10000 }) });

export function verifyOpenPool(receipt: TransactionReceipt, transaction: { input: Hex; from: string }) {
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("A successful pool creation transaction is required.");
  const created = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== receipt.contractAddress!.toLowerCase()) return [];
    try { return [decodeEventLog({ abi: openPoolAbi, data: log.data, topics: log.topics }).args]; } catch { return []; }
  })[0];
  if (!created || created.creator.toLowerCase() !== transaction.from.toLowerCase()
    || created.poolId !== openPoolId(created.fee)
    || transaction.input.toLowerCase() !== openPoolDeploymentData(created.fee, created.sqrtPriceX96).toLowerCase()) {
    throw new Error("Transaction does not deploy the supported Nacre pool contract.");
  }
  const initialized = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== OPEN_POOL_MANAGER.toLowerCase()) return false;
    try {
      const { args } = decodeEventLog({ abi: poolInitializeAbi, data: log.data, topics: log.topics });
      return args.id === created.poolId && args.sqrtPriceX96 === created.sqrtPriceX96 && args.tick === created.tick;
    } catch { return false; }
  });
  if (!initialized) throw new Error("PoolManager did not confirm this pool's initialization.");
  return created;
}
export async function registerOpenPool(db: Database, hash: Hex) {
  const [receipt, transaction] = await Promise.all([client.getTransactionReceipt({ hash }), client.getTransaction({ hash })]);
  return saveVerifiedOpenPool(db, hash, receipt, transaction);
}
export function saveVerifiedOpenPool(db: Database, hash: Hex, receipt: TransactionReceipt, transaction: { input: Hex; from: string }) {
  if (receipt.transactionHash !== hash) throw new Error("Transaction hash does not match its receipt.");
  const created = verifyOpenPool(receipt, transaction);
  const marketId = db.transaction(() => {
    const existing = db.query("SELECT market_id FROM open_pool_configs WHERE pool_id = ?").get(created.poolId) as { market_id: string } | null;
    if (existing) return existing.market_id;
    const id = crypto.randomUUID(), now = new Date().toISOString();
    const ratio = Number(created.sqrtPriceX96) / 2 ** 96;
    const price = ratio * ratio * 1e12;
    // These are UI input limits, not LP/underwriter ranges or funding targets.
    const minimum = .01, maximum = 1_000_000;
    db.prepare(`INSERT INTO market_drafts (id,creator,reference_pool_id,price_usd,lower_price_usd,upper_price_usd,tick,tick_lower,tick_upper,liquidity_target_usd,collateral_budget_usd,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, created.creator.toLowerCase(), VALID_REFERENCE, price, minimum, maximum,
        priceToTick(price), priceToTick(minimum), priceToTick(maximum), 0, 0, now);
    db.prepare("INSERT INTO market_deployments VALUES (?,?,?,?)").run(id, hash, created.poolId, now);
    db.prepare("INSERT INTO open_pool_configs VALUES (?,?,?,?,?)").run(created.poolId, id, receipt.contractAddress!, created.offerFactory, created.fee);
    return id;
  })();
  return presentMarket(db, getMarket(db, marketId)!);
}
