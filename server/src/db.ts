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
    CREATE TABLE IF NOT EXISTS market_drafts (
      id TEXT PRIMARY KEY,
      creator TEXT NOT NULL,
      reference_pool_id TEXT NOT NULL,
      price_usd REAL NOT NULL,
      lower_price_usd REAL NOT NULL,
      upper_price_usd REAL NOT NULL,
      tick INTEGER NOT NULL,
      tick_lower INTEGER NOT NULL,
      tick_upper INTEGER NOT NULL,
      liquidity_target_usd REAL NOT NULL,
      collateral_budget_usd REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_archives (
      market_id TEXT PRIMARY KEY REFERENCES market_drafts(id),
      archived_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_pledges (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES market_drafts(id),
      participant TEXT NOT NULL,
      capacity_usd REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_price_events (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES market_drafts(id),
      price_usd REAL NOT NULL,
      tick INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS oracle_price_samples (
      published_at TEXT PRIMARY KEY,
      weth_usdc REAL NOT NULL,
      weth_usd REAL NOT NULL,
      usdc_usd REAL NOT NULL,
      source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_positions (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES market_drafts(id),
      participant TEXT NOT NULL,
      deposit_usd REAL NOT NULL,
      insured INTEGER NOT NULL,
      floor_usd REAL NOT NULL,
      premium_usd REAL NOT NULL,
      payout_cap_usd REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_deployments (
      market_id TEXT PRIMARY KEY REFERENCES market_drafts(id),
      tx_hash TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      deployed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS market_chain_positions (
      token_id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL REFERENCES market_drafts(id),
      owner TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      weth_raw TEXT NOT NULL,
      usdc_raw TEXT NOT NULL,
      minted_at TEXT NOT NULL
    );
  `);
  const columns = db.query("PRAGMA table_info(observations)").all() as { name: string }[];
  if (!columns.some((column) => column.name === "volume_usd")) {
    db.exec("ALTER TABLE observations ADD COLUMN volume_usd REAL NOT NULL DEFAULT 0");
  }
  if (!columns.some((column) => column.name === "gross_pool_fees_usd")) {
    db.exec("ALTER TABLE observations ADD COLUMN gross_pool_fees_usd REAL NOT NULL DEFAULT 0");
  }
  const positionColumns = db.query("PRAGMA table_info(market_positions)").all() as { name: string }[];
  if (!positionColumns.some((column) => column.name === "lower_price_usd")) {
    db.exec("ALTER TABLE market_positions ADD COLUMN lower_price_usd REAL");
    db.exec("ALTER TABLE market_positions ADD COLUMN upper_price_usd REAL");
  }
  const pledgeColumns = db.query("PRAGMA table_info(market_pledges)").all() as { name: string }[];
  if (!pledgeColumns.some((column) => column.name === "premium_usd")) {
    db.exec("ALTER TABLE market_pledges ADD COLUMN premium_usd REAL");
    db.exec("ALTER TABLE market_pledges ADD COLUMN example_deposit_usd REAL");
  }
  return db;
}

export function seedDb(db: Database, snapshot: Snapshot): void {
  const insertPool = db.prepare(`INSERT OR REPLACE INTO pools
    (id, symbol, fee_tier, llama_id, source, captured_at) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertObservation = db.prepare(`INSERT OR REPLACE INTO observations
    (pool_id, date, apy_base_pct, tvl_usd, volume_usd, gross_pool_fees_usd)
    VALUES (?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    const ids = POOLS.map((pool) => pool.id);
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM observations WHERE pool_id NOT IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM pools WHERE id NOT IN (${placeholders})`).run(...ids);
    for (const pool of POOLS) {
      insertPool.run(pool.id, pool.symbol, pool.feeTier, pool.llamaId, snapshot.source, snapshot.capturedAt);
      db.prepare("DELETE FROM observations WHERE pool_id = ?").run(pool.id);
      const history = snapshot.pools.find((entry) => entry.id === pool.id);
      if (!history) throw new Error(`Missing history for ${pool.id}`);
      for (const row of history.observations) {
        insertObservation.run(pool.id, row.date, row.apyBasePct, row.tvlUsd,
          row.volumeUsd, row.grossPoolFeesUsd);
      }
    }
  })();
}

export function getObservations(db: Database, poolId: PoolId): Observation[] {
  const rows = db.query(`SELECT date, apy_base_pct, tvl_usd, volume_usd, gross_pool_fees_usd FROM observations
    WHERE pool_id = ? ORDER BY date`).all(poolId) as {
      date: string; apy_base_pct: number; tvl_usd: number;
      volume_usd: number; gross_pool_fees_usd: number;
    }[];
  return rows.map((row) => ({
    date: row.date,
    apyBasePct: row.apy_base_pct,
    tvlUsd: row.tvl_usd,
    volumeUsd: row.volume_usd,
    grossPoolFeesUsd: row.gross_pool_fees_usd,
  }));
}
