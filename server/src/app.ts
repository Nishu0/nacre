import cors from "@fastify/cors";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { backtest, indicativeQuotes } from "./backtest";
import { getObservations, openDb, seedDb } from "./db";
import { POOLS, type PoolId, type Snapshot } from "./market-data";
import { getMarket, listMarkets, listPositions, presentMarket, priceToTick, quotePosition, VALID_REFERENCE } from "./market-model";

type CreateMarket = { creator: string; priceUsd: number; lowerPriceUsd: number;
  upperPriceUsd: number; liquidityTargetUsd: number; collateralBudgetUsd: number };
type FundRequest = { participant: string; amountUsd: number };
const validParticipant = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{8,100}$/.test(value);
const inRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

export function buildApp(databasePath?: string) {
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

  // These routes persist an interactive sandbox. They never move tokens or
  // report an on-chain pool, position, Aqua balance, or active insurance.
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
    return reply.code(201).send({ market: presentMarket(db, getMarket(db, id)!) });
  });

  app.get<{ Params: { marketId: string } }>("/api/markets/:marketId", async (request, reply) => {
    const row = getMarket(db, request.params.marketId);
    return row ? { market: presentMarket(db, row) } : reply.code(404).send({ error: "Unknown market" });
  });

  app.get<{ Params: { marketId: string }; Querystring: { depositUsd?: string } }>(
    "/api/markets/:marketId/quote", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const depositUsd = Number(request.query.depositUsd ?? "1000");
      if (!inRange(depositUsd, 100, 1_000_000)) {
        return reply.code(400).send({ error: "Deposit must be between $100 and $1,000,000." });
      }
      return { market: presentMarket(db, row), quote: quotePosition(db, row, depositUsd) };
    },
  );

  app.post<{ Params: { marketId: string }; Body: FundRequest }>(
    "/api/markets/:marketId/pledges", async (request, reply) => {
      const row = getMarket(db, request.params.marketId);
      if (!row) return reply.code(404).send({ error: "Unknown market" });
      const body = request.body;
      if (!body || !validParticipant(body.participant) || !inRange(body.amountUsd, 1, 10_000_000)) {
        return reply.code(400).send({ error: "Enter a valid participant and capacity amount." });
      }
      db.prepare("INSERT INTO market_pledges VALUES (?, ?, ?, ?, ?)")
        .run(crypto.randomUUID(), row.id, body.participant, body.amountUsd, new Date().toISOString());
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
      const id = crypto.randomUUID();
      const result = db.transaction(() => {
        db.prepare("INSERT INTO market_positions VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?)")
          .run(id, row.id, body.participant, body.amountUsd, new Date().toISOString());
        if (body.requestCover) {
          const quote = quotePosition(db, row, body.amountUsd);
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
        .get(request.params.positionId, row.id) as { participant: string; deposit_usd: number; insured: number } | null;
      if (!position || position.participant !== request.body?.participant || position.insured) {
        return reply.code(404).send({ error: "Position is unavailable for coverage." });
      }
      const result = db.transaction(() => {
        const quote = quotePosition(db, row, position.deposit_usd);
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
      return { market: presentMarket(db, getMarket(db, row.id)!) };
    },
  );

  app.get<{ Querystring: { participant?: string } }>("/api/portfolio", async (request, reply) => {
    if (!validParticipant(request.query.participant)) {
      return reply.code(400).send({ error: "A sandbox participant ID is required." });
    }
    return { mode: "sandbox", positions: listPositions(db, request.query.participant) };
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
