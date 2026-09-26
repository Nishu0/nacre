import { writeFileSync } from "node:fs";
import { POOLS, type Observation, type Snapshot } from "./market-data";
import { openDb, seedDb } from "./db";

const through = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const from = new Date(Date.parse(`${through}T00:00:00Z`) - 91 * 86_400_000).toISOString().slice(0, 10);

const pools = await Promise.all(POOLS.map(async (pool) => {
  const response = await fetch(`https://yields.llama.fi/chart/${pool.llamaId}`);
  if (!response.ok) throw new Error(`DefiLlama ${pool.id}: HTTP ${response.status}`);
  const body = await response.json() as {
    status: string;
    data: { timestamp: string; apyBase: number | null; tvlUsd: number | null }[];
  };
  if (body.status !== "success") throw new Error(`DefiLlama ${pool.id}: failed response`);
  const byDate = new Map<string, Observation>();
  for (const row of body.data) {
    const date = row.timestamp.slice(0, 10);
    if (date < from || date > through) continue;
    if (!Number.isFinite(row.apyBase) || !Number.isFinite(row.tvlUsd)) continue;
    byDate.set(date, { date, apyBasePct: row.apyBase!, tvlUsd: row.tvlUsd! });
  }
  const observations = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (observations.length < 90) throw new Error(`${pool.id}: only ${observations.length} valid days`);
  return { id: pool.id, observations };
}));

const snapshot: Snapshot = {
  source: "DefiLlama Yields API",
  capturedAt: new Date().toISOString(),
  from,
  through,
  pools,
};
writeFileSync(new URL("../data/pool-history.json", import.meta.url), JSON.stringify(snapshot, null, 2) + "\n");
const db = openDb();
seedDb(db, snapshot);
db.close();
console.log(`Refreshed ${pools.length} pools, ${from} to ${through}`);
