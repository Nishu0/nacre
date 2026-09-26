import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Observation, PoolId, Snapshot } from "./market-data";
import { POOLS } from "./market-data";

export const DATABASE_PATH = resolve(
  process.env.DATABASE_PATH ?? new URL("../data/nacre.sqlite", import.meta.url).pathname,
);

export function openDb(path = DATABASE_PATH): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      fee_tier TEXT NOT NULL,
      llama_id TEXT NOT NULL,
      source TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      pool_id TEXT NOT NULL REFERENCES pools(id),
      date TEXT NOT NULL,
      apy_base_pct REAL NOT NULL,
      tvl_usd REAL NOT NULL,
      PRIMARY KEY (pool_id, date)
    );
  `);
  return db;
}

export function seedDb(db: Database, snapshot: Snapshot): void {
  const insertPool = db.prepare(`INSERT OR REPLACE INTO pools
    (id, symbol, fee_tier, llama_id, source, captured_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertObservation = db.prepare(`INSERT OR REPLACE INTO observations
    (pool_id, date, apy_base_pct, tvl_usd) VALUES (?, ?, ?, ?)`);
  db.transaction(() => {
    for (const pool of POOLS) {
      insertPool.run(pool.id, pool.symbol, pool.feeTier, pool.llamaId, snapshot.source, snapshot.capturedAt);
      db.prepare("DELETE FROM observations WHERE pool_id = ?").run(pool.id);
      const history = snapshot.pools.find((entry) => entry.id === pool.id);
      if (!history) throw new Error(`Missing history for ${pool.id}`);
      for (const row of history.observations) {
        insertObservation.run(pool.id, row.date, row.apyBasePct, row.tvlUsd);
      }
    }
  })();
}

export function getObservations(db: Database, poolId: PoolId): Observation[] {
  const rows = db.query(`SELECT date, apy_base_pct, tvl_usd FROM observations
    WHERE pool_id = ? ORDER BY date`).all(poolId) as {
      date: string; apy_base_pct: number; tvl_usd: number;
    }[];
  return rows.map((row) => ({
    date: row.date,
    apyBasePct: row.apy_base_pct,
    tvlUsd: row.tvl_usd,
  }));
}
