import type { Database } from "bun:sqlite";
import { TEST_POOLS, testPool, NACRE_TEST_WETH, type TestPoolConfig } from "../../frontend/src/lib/test-pools";
export function registeredPool(db: Database, id?: string): TestPoolConfig | undefined {
  const existing = testPool(id);
  if (existing) return existing;
  if (!id) return undefined;
  const row = db.query("SELECT pool_id, launcher, factory, fee FROM open_pool_configs WHERE pool_id = ?").get(id.toLowerCase()) as { pool_id: `0x${string}`; launcher: `0x${string}`; factory: `0x${string}`; fee: number } | null;
  return row ? { poolId: row.pool_id, weth: NACRE_TEST_WETH, symbol: "nWETH", factory: row.factory, launcher: row.launcher, fee: row.fee } : undefined;
}
export function allPoolConfigs(db: Database) {
  const ids = db.query("SELECT pool_id FROM open_pool_configs").all() as { pool_id: string }[];
  return [...TEST_POOLS, ...ids.map((row) => registeredPool(db, row.pool_id)!)];
}
