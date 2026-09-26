import cors from "@fastify/cors";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { backtest, indicativeQuotes } from "./backtest";
import { getObservations, openDb, seedDb } from "./db";
import { POOLS, type PoolId, type Snapshot } from "./market-data";

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
      dataSource: `https://yields.llama.fi/chart/${pool.llamaId}`,
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
        source: `https://yields.llama.fi/chart/${pool.llamaId}`,
        method: "Pool-level apyBase / 365 x principal, summed over consecutive 30-day windows. This is not observed fees for an individual concentrated LP position or a Uniswap v4 pool.",
        ...backtest(observations, principalUsd),
      };
    },
  );

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
        source: `https://yields.llama.fi/chart/${pool.llamaId}`,
        warning: "Indicative research prices only. Concentrated-position fees, token price risk, and underwriter quotes are not captured by the pool-level series.",
        ...indicativeQuotes(observations, principalUsd),
      };
    },
  );

  return app;
}
