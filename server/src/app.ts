import { atomicPurchase } from "../../frontend/src/lib/atomic-checkout";
import { COVERAGE_VAULT } from "../../frontend/src/lib/coverage-contracts";
import { poolActivity } from "./pool-activity";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { backtest, feeRequestPreview, indicativeQuotes } from "./backtest";
import { getObservations, openDb, seedDb } from "./db";
import { POOLS, type PoolId, type Snapshot } from "./market-data";
import { coverageSnapshot } from "./coverage";
import { activeCoverage } from "./workspace-state";
import { TEST_POOLS, TEST_WETH_POOL, LEGACY_WETH_POOL } from "../../frontend/src/lib/test-pools";
import { registeredPool, allPoolConfigs } from "./pool-registry";
import { registerOpenPool } from "./open-pools";
import { readAtMintBlock } from "./position-registration";
import { getHyperliquidHistory, type PriceHistory } from "./hyperliquid";
import { getLivePrices, type LivePrices } from "./live-prices";
import { buildRiskAnalysis } from "./risk-analysis";
import { getMarket, listMarkets, listPositions, presentMarket, priceToTick, quotePosition, VALID_REFERENCE } from "./market-model";
import { createPublicClient, decodeEventLog, http, parseAbi, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

type CreateMarket = { creator: string; priceUsd: number; lowerPriceUsd: number;
  upperPriceUsd: number; liquidityTargetUsd: number; collateralBudgetUsd: number };
type FundRequest = { participant: string; amountUsd: number;
  premiumUsd?: number; exampleDepositUsd?: number; lowerPriceUsd?: number; upperPriceUsd?: number };
const validParticipant = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{8,100}$/.test(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
function selectedRange(row: { lower_price_usd: number; upper_price_usd: number }, lower?: number, upper?: number) {
  const bottom = lower ?? row.lower_price_usd;
  const top = upper ?? row.upper_price_usd;
  if (!inRange(bottom, row.lower_price_usd, row.upper_price_usd)
    || !inRange(top, row.lower_price_usd, row.upper_price_usd)
    || bottom >= top || priceToTick(bottom) >= priceToTick(top)) return null;
  return { bottom, top };
}
const ADMIN = "0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288";
const LAUNCHER = "0x49FcA731F70DaF38d828E34204F2437E75a605a6";
const POSITION_MANAGER = "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80";
const POOL_MANAGER = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408";
const WETH = "0x4200000000000000000000000000000000000006";
const TEST_USDC = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8";
const HOOK = "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00";
const launchEvents = parseAbi([
  "event PoolLaunched(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, address indexed admin)",
]);
const positionEvents = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)"]);
const tokenEvents = parseAbi(["event Transfer(address indexed from,address indexed to,uint256 value)"]);
const positionReads = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
]);
const chainClient = createPublicClient({ chain: baseSepolia,
  transport: http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org") });

export function buildApp(databasePath?: string, priceProvider: () => Promise<LivePrices> = getLivePrices,
  historyProvider: () => Promise<PriceHistory> = getHyperliquidHistory) {
  const app = Fastify({ logger: true });
  const db = openDb(databasePath);
  const existingObservations = db.query("SELECT COUNT(*) AS count FROM observations").get() as { count: number };
  if (existingObservations.count === 0) {
    const snapshot = JSON.parse(
      readFileSync(new URL("../data/pool-history.json", import.meta.url), "utf8"),
    ) as Snapshot;
    seedDb(db, snapshot);
  }

  app.addHook("onClose", async () => db.close());

  // Internet deployment exposes verified transaction registration, not local
  // sandbox writes that can change simulated market prices and positions.
  if (process.env.NACRE_PUBLIC_DEPLOYMENT === "1") {
    app.addHook("onRequest", (request, reply, done) => {
      if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return done();
      const path = request.url.split("?")[0];
      const registration = request.method === "POST" && (path === "/api/open-pools"
        || /^\/api\/markets\/[0-9a-f-]{36}\/chain-positions$/i.test(path));
      if (!registration) {
        reply.code(403).send({ error: "Local sandbox actions are disabled on the public service." });
        return;
      }
      done();
    });
  }

  app.register(cors, {
    origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "nacre-server",
  }));

  app.get("/api/pools", async () => {
    const seeded = db.query("SELECT id, captured_at FROM pools").all() as {
      id: string; captured_at: string;
    }[];
    return POOLS.map((pool) => ({
      ...pool,
      chain: "Ethereum",
      protocol: "Uniswap v3",
      dataSource: `https://www.geckoterminal.com/eth/pools/${pool.address}`,
      yieldSource: `https://defillama.com/yields/pool/${pool.llamaId}`,
      capturedAt: seeded.find((row) => row.id === pool.id)?.captured_at ?? null,
    }));
  });

  app.get<{ Querystring: { fresh?: string; poolId?: string } }>("/api/coverage", async (request, reply) => {
    if (request.query.poolId && !registeredPool(db, request.query.poolId)) return reply.code(400).send({ error: "Unknown coverage pool" });
    try {
      const rows = db.query("SELECT token_id FROM market_chain_positions").all() as { token_id: string }[];
      const configs = request.query.poolId ? [registeredPool(db, request.query.poolId)!] : allPoolConfigs(db).filter((pool) => pool.poolId !== LEGACY_WETH_POOL);
      const snapshots = await Promise.all(configs.map((config) => coverageSnapshot(rows.map((row) => row.token_id), request.query.fresh === "1", config.poolId, config)));
      const combined = { ...snapshots[0], offers: snapshots.flatMap((s) => s.offers), requests: snapshots.flatMap((s) => s.requests),
        positions: snapshots.flatMap((s) => s.positions), poolTicks: Object.assign({}, ...snapshots.map((s) => s.poolTicks)),
        reserved: String(snapshots.reduce((n, s) => n + BigInt(s.reserved), 0n)) };
      return activeCoverage(db, combined);
    } catch (error) {
      app.log.error(error, "Coverage chain read failed");
      return reply.code(503).send({ error: "Could not read coverage from Base Sepolia. Please retry." });
    }
  });

  // Technical pool configuration remains available after clearing the workspace.
  // Only newly funded bids are listed in the investor marketplace.
  app.get<{ Querystring: { poolId?: string } }>("/api/bid-market", async (request, reply) => {
    const deployment = db.query("SELECT market_id FROM market_deployments WHERE pool_id = ? ORDER BY deployed_at DESC LIMIT 1").get(request.query.poolId ?? TEST_WETH_POOL) as { market_id: string } | null;
    const market = deployment && getMarket(db, deployment.market_id);
    if (!market) return reply.code(404).send({ error: "The nWETH market is not configured." });
    return { market: presentMarket(db, market) };
  });

  app.get<{ Querystring: { poolId?: string } }>("/api/pool-activity", async (request, reply) => {
    const poolId = request.query.poolId;
    if (!poolId || !registeredPool(db, poolId)) return reply.code(400).send({ error: "Unknown pool" });
    const row = db.query("SELECT tx_hash FROM market_deployments WHERE pool_id = ? ORDER BY deployed_at DESC LIMIT 1").get(poolId) as { tx_hash: Hex } | null;
    if (!row) return reply.code(404).send({ error: "Pool deployment unavailable" });
    try { return await poolActivity(poolId as Hex, row.tx_hash); }
    catch (error) { app.log.error(error); return reply.code(503).send({ error: "Pool fee activity unavailable; retry shortly." }); }
  });

  app.get("/api/bid-markets", async () => {
    const rows = db.query("SELECT market_id FROM market_deployments WHERE pool_id = ? OR pool_id IN (SELECT pool_id FROM open_pool_configs) ORDER BY deployed_at DESC").all(TEST_WETH_POOL) as { market_id: string }[];
    return { markets: rows.flatMap((row) => { const market = getMarket(db, row.market_id); return market ? [presentMarket(db, market)] : []; }) };
  });
  app.post<{ Body: { txHash?: string } }>("/api/open-pools", async (request, reply) => {
    const hash = request.body?.txHash;
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return reply.code(400).send({ error: "A pool creation transaction hash is required." });
    try { return { market: await registerOpenPool(db, hash as Hex) }; }
    catch (reason) { return reply.code(409).send({ error: reason instanceof Error ? reason.message : "Could not verify pool creation." }); }
  });

  app.get("/api/live-prices", async (_request, reply) => {
    try {
      const live = await priceProvider();
      return live;
    }
    catch { return reply.code(503).send({ error: "Live Hyperliquid prices are unavailable. Try again shortly." }); }
  });

  app.get("/api/live-price-history", async (_request, reply) => {
    try { return await historyProvider(); }
    catch { return reply.code(503).send({ error: "Hyperliquid price history is unavailable." }); }
  });

  app.get<{ Params: { poolId: string }; Querystring: { principalUsd?: string } }>(
    "/api/pools/:poolId/backtest",
    async (request, reply) => {
      const pool = POOLS.find((entry) => entry.id === request.params.poolId);
      if (!pool) return reply.code(404).send({ error: "Unknown pool" });
      const principalUsd = Number(request.query.principalUsd ?? "100000");
      if (!Number.isFinite(principalUsd) || principalUsd < 100 || principalUsd > 10_000_000) {
        return reply.code(400).send({ error: "principalUsd must be between 100 and 10000000" });
      }
      const observations = getObservations(db, pool.id as PoolId);
      if (!observations.length) return reply.code(503).send({ error: "Run bun run db:seed first" });
      return {
        pool,
        source: {
          volume: `https://www.geckoterminal.com/eth/pools/${pool.address}`,
          yield: `https://defillama.com/yields/pool/${pool.llamaId}`,
        },
        method: "Six months of aligned GeckoTerminal daily volume and DefiLlama pool base APY/TVL. Gross pool fees = volume x nominal fee tier, before protocol share. Modeled position fees = pool-level apyBase / 365 x principal. A specific concentrated range may earn much more, less, or zero.",
        ...backtest(observations, principalUsd),
      };
    },
  );

  // Funding records are simulations. A separate endpoint verifies an actual
  // Base Sepolia receipt before showing an on-chain pool deployment.
  app.get("/api/markets", async () => ({ mode: "sandbox", markets: listMarkets(db) }));

  app.post<{ Body: CreateMarket }>("/api/markets", async (request, reply) => {
    const body = request.body;
    if (!body || !validParticipant(body.creator)
      || !inRange(body.priceUsd, 0.01, 1_000_000)
      || !inRange(body.lowerPriceUsd, 0.01, 1_000_000)
      || !inRange(body.upperPriceUsd, 0.01, 1_000_000)
      || body.lowerPriceUsd >= body.priceUsd || body.priceUsd >= body.upperPriceUsd
      || !inRange(body.liquidityTargetUsd, 100, 10_000_000)
      || !inRange(body.collateralBudgetUsd, 1, 10_000_000)) {
      return reply.code(400).send({ error: "Enter valid prices, funding targets, and a participant ID." });
    }
    const tick = priceToTick(body.priceUsd);
    const tickLower = priceToTick(body.lowerPriceUsd);
    const tickUpper = priceToTick(body.upperPriceUsd);
    if (!(tickLower < tick && tick < tickUpper)) {
      return reply.code(400).send({ error: "The selected prices must span at least one tick spacing on each side." });
    }
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO market_drafts (id, creator, reference_pool_id, price_usd,
      lower_price_usd, upper_price_usd, tick, tick_lower, tick_upper,
      liquidity_target_usd, collateral_budget_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, body.creator, VALID_REFERENCE, body.priceUsd, body.lowerPriceUsd,
        body.upperPriceUsd, tick, tickLower, tickUpper,
        body.liquidityTargetUsd, body.collateralBudgetUsd, new Date().toISOString());
    db.prepare("INSERT INTO market_price_events VALUES (?, ?, ?, ?, ?)")
      .run(crypto.randomUUID(), id, body.priceUsd, tick, new Date().toISOString());
    return reply.code(201).send({ market: presentMarket(db, getMarket(db, id)!) });
  });

  app.get<{ Params: { marketId: string } }>("/api/markets/:marketId", async (request, reply) => {
    const row = getMarket(db, request.params.marketId);
    return row ? { market: presentMarket(db, row) } : reply.code(404).send({ error: "Unknown market" });
  });

  app.post<{ Params: { marketId: string }; Body: { txHash?: string } }>(
    "/api/markets/:marketId/deployment", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const market = presentMarket(db, row);
      if (market.deployment) return { market };
      const txHash = request.body?.txHash;
      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
        return reply.code(400).send({ error: "A confirmed transaction hash is required." });
      }
      try {
        const receipt = await chainClient.getTransactionReceipt({ hash: txHash as Hex });
        // Smart wallets may batch or relay the call, so transaction.from/to need
        // not be the admin or launcher. The launcher event is emitted only after
        // its on-chain msg.sender == admin check succeeds.
        if (receipt.status !== "success") {
          throw new Error("This is not a successful pool launch transaction.");
        }
        const launched = receipt.logs.find((log) => {
          if (!TEST_POOLS.some((pool) => pool.launcher.toLowerCase() === log.address.toLowerCase())) return false;
          try {
            const decoded = decodeEventLog({ abi: launchEvents, data: log.data, topics: log.topics });
            return decoded.eventName === "PoolLaunched" && decoded.args.admin.toLowerCase() === ADMIN.toLowerCase();
          } catch { return false; }
        });
        if (!launched) throw new Error("The transaction has no Nacre pool launch event.");
        const decoded = decodeEventLog({ abi: launchEvents, data: launched.data, topics: launched.topics });
        const poolId = decoded.args.poolId;
        if (!TEST_POOLS.some((pool) => pool.poolId === poolId && pool.launcher.toLowerCase() === launched.address.toLowerCase())) {
          throw new Error("Unrecognized pool deployment.");
        }
        // The test-WETH bootstrap initializes its immutable pair in its constructor.
        // Its verified event proves initialization without inventing sandbox funding.
        if (poolId !== TEST_WETH_POOL && (!market.funded || !market.inRange)) {
          throw new Error("Both funding targets and an in-range tick are required before launch.");
        }
        if (db.query("SELECT market_id FROM market_deployments WHERE pool_id = ?").get(poolId)) {
          throw new Error("This pool has already been assigned to a market.");
        }
        db.prepare("INSERT INTO market_deployments VALUES (?, ?, ?, ?)")
          .run(row.id, txHash, poolId, new Date().toISOString());
        return { market: presentMarket(db, row) };
      } catch (reason) {
        return reply.code(409).send({ error: reason instanceof Error ? reason.message : "Could not verify launch transaction." });
      }
    },
  );

  app.post<{ Params: { marketId: string }; Body: { txHash?: string; account?: string } }>(
    "/api/markets/:marketId/chain-positions", async (request, reply) => {
      const market = getMarket(db, request.params.marketId);
      if (!market || !presentMarket(db, market).deployment) {
        return reply.code(409).send({ error: "Deploy the pool before registering a live position." });
      }
      const { txHash, account } = request.body ?? {};
      if (!txHash || !/^0x[0-9a-fA-F]{64}$/.test(txHash)
        || !account || !/^0x[0-9a-fA-F]{40}$/.test(account)) {
        return reply.code(400).send({ error: "A transaction hash and wallet address are required." });
      }
      try {
        const receipt = await chainClient.getTransactionReceipt({ hash: txHash as Hex });
        if (receipt.status !== "success") throw new Error("Mint transaction did not succeed.");
        const checkout = atomicPurchase(receipt.logs, account);
        const mintRecipient = checkout?.account ?? account;
        const mint = receipt.logs.find((log) => {
          if (log.address.toLowerCase() !== POSITION_MANAGER.toLowerCase()) return false;
          try {
            const event = decodeEventLog({ abi: positionEvents, data: log.data, topics: log.topics });
            return event.args.from === "0x0000000000000000000000000000000000000000"
              && event.args.to.toLowerCase() === mintRecipient.toLowerCase()
              && (!checkout || event.args.tokenId === checkout.tokenId);
          } catch { return false; }
        });
        if (!mint) throw new Error("No PositionManager NFT mint to this wallet was found.");
        const tokenId = decodeEventLog({ abi: positionEvents, data: mint.data, topics: mint.topics }).args.tokenId;
        const [owner, [key]] = await readAtMintBlock(receipt.blockNumber, (blockNumber) => Promise.all([
          chainClient.readContract({ address: POSITION_MANAGER, abi: positionReads,
            functionName: "ownerOf", args: [tokenId], blockNumber }),
          chainClient.readContract({ address: POSITION_MANAGER, abi: positionReads,
            functionName: "getPoolAndPositionInfo", args: [tokenId], blockNumber }),
        ]));
        if (owner.toLowerCase() !== (checkout ? COVERAGE_VAULT : account).toLowerCase()
          || key.currency0.toLowerCase() !== (registeredPool(db, presentMarket(db, market).deployment?.poolId)?.weth ?? WETH).toLowerCase()
          || key.currency1.toLowerCase() !== TEST_USDC.toLowerCase()
          || key.hooks.toLowerCase() !== HOOK.toLowerCase()
          || key.fee !== (registeredPool(db, presentMarket(db, market).deployment?.poolId)?.fee ?? 500) || key.tickSpacing !== 10) {
          throw new Error("This position does not belong to the Nacre WETH/nUSDC pool.");
        }
        const transferred = (token: string) => receipt.logs.reduce((total, log) => {
          if (log.address.toLowerCase() !== token.toLowerCase()) return total;
          try {
            const event = decodeEventLog({ abi: tokenEvents, data: log.data, topics: log.topics });
            if (event.args.from.toLowerCase() === mintRecipient.toLowerCase()
              && event.args.to.toLowerCase() === POOL_MANAGER.toLowerCase()) return total + event.args.value;
          } catch { /* Another event from the token contract. */ }
          return total;
        }, BigInt(0));
        db.prepare(`INSERT OR IGNORE INTO market_chain_positions
          (token_id, market_id, owner, tx_hash, weth_raw, usdc_raw, minted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(tokenId.toString(), market.id, account.toLowerCase(), txHash,
            transferred(registeredPool(db, presentMarket(db, market).deployment?.poolId)?.weth ?? WETH).toString(), transferred(TEST_USDC).toString(), new Date().toISOString());
        return { tokenId: tokenId.toString(), txHash, marketId: market.id };
      } catch (reason) {
        return reply.code(409).send({ error: reason instanceof Error ? reason.message : "Could not verify position mint." });
      }
    },
  );

  app.get<{ Querystring: { account?: string; marketId?: string } }>("/api/chain-positions", async (request, reply) => {
    const { account, marketId } = request.query;
    if (account && !/^0x[0-9a-fA-F]{40}$/.test(account)) {
      return reply.code(400).send({ error: "A valid wallet address is required." });
    }
    if (marketId && !getMarket(db, marketId)) {
      return reply.code(404).send({ error: "Unknown market." });
    }
    const rows = db.query(`SELECT p.token_id, p.market_id, p.tx_hash, p.weth_raw, p.usdc_raw, p.minted_at, d.pool_id
      FROM market_chain_positions p LEFT JOIN market_deployments d ON d.market_id = p.market_id
      WHERE (? IS NULL OR p.owner = ?) AND (? IS NULL OR p.market_id = ?)
      AND NOT EXISTS (SELECT 1 FROM workspace_archives a WHERE a.kind = 'position' AND a.item_id = p.token_id)
      AND (d.pool_id = '${TEST_WETH_POOL}' OR d.pool_id IN (SELECT pool_id FROM open_pool_configs))
      ORDER BY p.minted_at DESC`).all(account?.toLowerCase() ?? null, account?.toLowerCase() ?? null,
      marketId ?? null, marketId ?? null) as {
      token_id: string; market_id: string; tx_hash: string; pool_id: string;
      weth_raw: string; usdc_raw: string; minted_at: string;
    }[];
    return { positions: rows.map((row) => ({ tokenId: row.token_id, marketId: row.market_id,
      wethSymbol: registeredPool(db, row.pool_id)?.symbol ?? "WETH", poolId: row.pool_id,
      txHash: row.tx_hash, wethRaw: row.weth_raw, usdcRaw: row.usdc_raw, mintedAt: row.minted_at })) };
  });

  app.get<{ Params: { marketId: string } }>("/api/markets/:marketId/price-history", async (request, reply) => {
    const row = getMarket(db, request.params.marketId);
    if (!row) return reply.code(404).send({ error: "Unknown market" });
    const events = db.query(`SELECT price_usd, tick, created_at FROM market_price_events
      WHERE market_id = ? ORDER BY created_at, rowid`).all(row.id) as {
      price_usd: number; tick: number; created_at: string;
    }[];
    return {
      mode: "sandbox",
      events: events.length ? events.map((event) => ({
        priceUsd: event.price_usd, tick: event.tick, createdAt: event.created_at,
      })) : [{ priceUsd: row.price_usd, tick: row.tick, createdAt: row.created_at }],
    };
  });

  app.get<{ Params: { marketId: string }; Querystring: { depositUsd?: string; lowerPriceUsd?: string; upperPriceUsd?: string } }>(
    "/api/markets/:marketId/quote", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const depositUsd = Number(request.query.depositUsd ?? "1000");
      if (!inRange(depositUsd, 100, 1_000_000)) {
        return reply.code(400).send({ error: "Deposit must be between $100 and $1,000,000." });
      }
      const range = selectedRange(row, request.query.lowerPriceUsd ? Number(request.query.lowerPriceUsd) : undefined,
        request.query.upperPriceUsd ? Number(request.query.upperPriceUsd) : undefined);
      if (!range) return reply.code(400).send({ error: "Choose a valid range inside the pool bounds." });
      return { market: presentMarket(db, row), quote: quotePosition(db, row, depositUsd, range.bottom, range.top) };
    },
  );

  app.get<{ Params: { marketId: string }; Querystring: { depositUsd?: string; days?: string; feeTargetUsd?: string } }>(
    "/api/markets/:marketId/fee-request", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const depositUsd = Number(request.query.depositUsd ?? "1000");
      const days = Number(request.query.days ?? "30");
      const target = request.query.feeTargetUsd === undefined ? undefined : Number(request.query.feeTargetUsd);
      if (!inRange(depositUsd, 100, 1_000_000) || ![7, 14, 30, 60, 90].includes(days)) {
        return reply.code(400).send({ error: "Enter a deposit between $100 and $1,000,000 and select 7, 14, 30, 60, or 90 days." });
      }
      try {
        return { mode: "research", ...feeRequestPreview(getObservations(db, row.reference_pool_id as PoolId),
          depositUsd, days, target) };
      } catch (reason) {
        return reply.code(400).send({ error: reason instanceof Error ? reason.message : "Invalid fee target." });
      }
    },
  );

  app.get<{ Params: { marketId: string }; Querystring: { depositUsd?: string; lowerPriceUsd?: string; upperPriceUsd?: string } }>(
    "/api/markets/:marketId/risk", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const depositUsd = Number(request.query.depositUsd ?? "1000");
      if (!inRange(depositUsd, 100, 1_000_000)) {
        return reply.code(400).send({ error: "Deposit must be between $100 and $1,000,000." });
      }
      const range = selectedRange(row, request.query.lowerPriceUsd ? Number(request.query.lowerPriceUsd) : undefined,
        request.query.upperPriceUsd ? Number(request.query.upperPriceUsd) : undefined);
      if (!range) return reply.code(400).send({ error: "Choose a valid position range." });
      const quote = quotePosition(db, row, depositUsd, range.bottom, range.top);
      const reference = POOLS.find((pool) => pool.id === row.reference_pool_id)!;
      return {
        mode: "research",
        marketId: row.id,
        referencePool: {
          id: reference.id, symbol: reference.symbol, feeTier: reference.feeTier,
          volumeUrl: `https://www.geckoterminal.com/eth/pools/${reference.address}`,
          yieldUrl: `https://defillama.com/yields/pool/${reference.llamaId}`,
        },
        analysis: buildRiskAnalysis(getObservations(db, reference.id), depositUsd,
          quote.feeFloorUsd, quote.payoutCapUsd),
        quote: {
          premiumUsd: quote.premiumUsd,
          expectedPayoutUsd: quote.expectedPayoutUsd,
          underwriterMarginUsd: quote.underwriterMarginUsd,
          edgeRiskPct: quote.edgeRiskPct,
          available: quote.available,
          reasons: quote.reasons,
        },
      };
    },
  );

  app.post<{ Params: { marketId: string }; Body: FundRequest }>(
    "/api/markets/:marketId/pledges", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const body = request.body;
      if (!body || !validParticipant(body.participant) || !inRange(body.amountUsd, 1, 10_000_000)
        || (body.premiumUsd !== undefined && !inRange(body.premiumUsd, 0.01, 1_000_000))
        || (body.exampleDepositUsd !== undefined && !inRange(body.exampleDepositUsd, 100, 1_000_000))) {
        return reply.code(400).send({ error: "Enter a valid participant and capacity amount." });
      }
      db.prepare(`INSERT INTO market_pledges
        (id, market_id, participant, capacity_usd, created_at, premium_usd, example_deposit_usd)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), row.id, body.participant,
          body.amountUsd, new Date().toISOString(), body.premiumUsd ?? null, body.exampleDepositUsd ?? null);
      return reply.code(201).send({ market: presentMarket(db, row), notice: "Sandbox pledge only. No USDC is locked." });
    },
  );

  app.post<{ Params: { marketId: string }; Body: FundRequest & { requestCover?: boolean } }>(
    "/api/markets/:marketId/positions", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const body = request.body;
      if (!body || !validParticipant(body.participant) || !inRange(body.amountUsd, 100, 1_000_000)) {
        return reply.code(400).send({ error: "Enter a valid participant and deposit amount." });
      }
      const range = selectedRange(row, body.lowerPriceUsd, body.upperPriceUsd);
      if (!range) return reply.code(400).send({ error: "Choose a valid position range inside the pool bounds." });
      const id = crypto.randomUUID();
      const result = db.transaction(() => {
        db.prepare(`INSERT INTO market_positions
          (id, market_id, participant, deposit_usd, insured, floor_usd, premium_usd,
           payout_cap_usd, created_at, lower_price_usd, upper_price_usd)
          VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?)`).run(id, row.id, body.participant,
            body.amountUsd, new Date().toISOString(), range.bottom, range.top);
        if (body.requestCover) {
          const quote = quotePosition(db, row, body.amountUsd, range.bottom, range.top);
          if (!quote.available) throw new Error(quote.reasons.join(" "));
          db.prepare(`UPDATE market_positions SET insured = 1, floor_usd = ?,
            premium_usd = ?, payout_cap_usd = ? WHERE id = ?`)
            .run(quote.feeFloorUsd, quote.premiumUsd, quote.payoutCapUsd, id);
        }
        return { id, market: presentMarket(db, row) };
      });
      try { return reply.code(201).send(result()); }
      catch (reason) { return reply.code(409).send({ error: reason instanceof Error ? reason.message : "Coverage unavailable" }); }
    },
  );

  app.post<{ Params: { marketId: string; positionId: string }; Body: { participant: string } }>(
    "/api/markets/:marketId/positions/:positionId/cover", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const position = db.query("SELECT * FROM market_positions WHERE id = ? AND market_id = ?")
        .get(request.params.positionId, row.id) as { participant: string; deposit_usd: number;
          insured: number; lower_price_usd: number | null; upper_price_usd: number | null } | null;
      if (!position || position.participant !== request.body?.participant || position.insured) {
        return reply.code(404).send({ error: "Position is unavailable for coverage." });
      }
      const result = db.transaction(() => {
        const quote = quotePosition(db, row, position.deposit_usd,
          position.lower_price_usd ?? row.lower_price_usd, position.upper_price_usd ?? row.upper_price_usd);
        if (!quote.available) throw new Error(quote.reasons.join(" "));
        db.prepare(`UPDATE market_positions SET insured = 1, floor_usd = ?,
          premium_usd = ?, payout_cap_usd = ? WHERE id = ? AND insured = 0`)
          .run(quote.feeFloorUsd, quote.premiumUsd, quote.payoutCapUsd, request.params.positionId);
        return { quote, market: presentMarket(db, row) };
      });
      try { return result(); }
      catch (reason) { return reply.code(409).send({ error: reason instanceof Error ? reason.message : "Coverage unavailable" }); }
    },
  );

  app.patch<{ Params: { marketId: string }; Body: { priceUsd: number } }>(
    "/api/markets/:marketId/price", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      if (!inRange(request.body?.priceUsd, 0.01, 1_000_000)) {
        return reply.code(400).send({ error: "Enter a valid sandbox price." });
      }
      const tick = priceToTick(request.body.priceUsd);
      db.prepare("UPDATE market_drafts SET price_usd = ?, tick = ? WHERE id = ?")
        .run(request.body.priceUsd, tick, row.id);
      db.prepare("INSERT INTO market_price_events VALUES (?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), row.id, request.body.priceUsd, tick, new Date().toISOString());
      return { market: presentMarket(db, getMarket(db, row.id)!) };
    },
  );

  app.post<{ Params: { marketId: string } }>(
    "/api/markets/:marketId/oracle-sync", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      try {
        // Read again server-side. A client-supplied price is never treated as an oracle quote.
        const live = await priceProvider();
        const priceUsd = live.wethUsdc;
        if (!inRange(priceUsd, 0.01, 1_000_000)) throw new Error("Invalid live price");
        const tick = priceToTick(priceUsd);
        db.transaction(() => {
          db.prepare("UPDATE market_drafts SET price_usd = ?, tick = ? WHERE id = ?")
            .run(priceUsd, tick, row.id);
          db.prepare("INSERT INTO market_price_events VALUES (?, ?, ?, ?, ?)")
            .run(crypto.randomUUID(), row.id, priceUsd, tick, new Date().toISOString());
        })();
        return { market: presentMarket(db, getMarket(db, row.id)!),
          source: live.source, publishedAt: live.assets.WETH.publishedAt };
      } catch {
        return reply.code(503).send({ error: "Live Hyperliquid prices are unavailable. Sandbox tick was not changed." });
      }
    },
  );

  app.get<{ Querystring: { participant?: string } }>("/api/portfolio", async (request, reply) => {
    if (!validParticipant(request.query.participant)) {
      return reply.code(400).send({ error: "A sandbox participant ID is required." });
    }
    return { mode: "sandbox", positions: listPositions(db, request.query.participant) };
  });

  app.get<{ Querystring: { participant?: string } }>("/api/underwriting", async (request, reply) => {
    if (!validParticipant(request.query.participant)) {
      return reply.code(400).send({ error: "A sandbox participant ID is required." });
    }
    const rows = db.query(`SELECT id, market_id, capacity_usd, premium_usd, example_deposit_usd, created_at FROM market_pledges
      WHERE participant = ? AND market_id NOT IN (SELECT market_id FROM market_archives) ORDER BY created_at DESC`).all(request.query.participant) as {
      id: string; market_id: string; capacity_usd: number; premium_usd: number | null;
      example_deposit_usd: number | null; created_at: string;
    }[];
    return { mode: "sandbox", pledges: rows.map((row) => ({
      id: row.id, marketId: row.market_id, capacityUsd: row.capacity_usd,
      premiumUsd: row.premium_usd, exampleDepositUsd: row.example_deposit_usd,
      createdAt: row.created_at,
    })) };
  });

  app.get<{ Params: { poolId: string }; Querystring: { principalUsd?: string } }>(
    "/api/pools/:poolId/quotes",
    async (request, reply) => {
      const pool = POOLS.find((entry) => entry.id === request.params.poolId);
      if (!pool) return reply.code(404).send({ error: "Unknown pool" });
      const principalUsd = Number(request.query.principalUsd ?? "100000");
      if (!Number.isFinite(principalUsd) || principalUsd < 100 || principalUsd > 10_000_000) {
        return reply.code(400).send({ error: "principalUsd must be between 100 and 10000000" });
      }
      const observations = getObservations(db, pool.id as PoolId);
      if (!observations.length) return reply.code(503).send({ error: "Run bun run db:seed first" });
      return {
        pool,
        source: `https://www.geckoterminal.com/eth/pools/${pool.address}`,
        warning: "Indicative research prices only. Concentrated-position fees, token price risk, and underwriter quotes are not captured by the pool-level series.",
        ...indicativeQuotes(observations, principalUsd),
      };
    },
  );

  return app;
}
