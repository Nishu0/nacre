import { writeFileSync } from "node:fs";
import { POOLS, type Observation, type Snapshot } from "./market-data";
import { openDb, seedDb } from "./db";

const through = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const from = new Date(Date.parse(`${through}T00:00:00Z`) - 179 * 86_400_000).toISOString().slice(0, 10);

const pools = await Promise.all(POOLS.map(async (pool) => {
  const [response, volumeResponse] = await Promise.all([
    fetch(`https://yields.llama.fi/chart/${pool.llamaId}`),
    fetch(`https://api.geckoterminal.com/api/v2/networks/eth/pools/${pool.address}/ohlcv/day?aggregate=1&limit=200&currency=usd`, {
      headers: { Accept: "application/json;version=20230203" },
    }),
  ]);
  if (!response.ok) throw new Error(`DefiLlama ${pool.id}: HTTP ${response.status}`);
  if (!volumeResponse.ok) throw new Error(`GeckoTerminal ${pool.id}: HTTP ${volumeResponse.status}`);
  const body = await response.json() as {
    status: string;
    data: { timestamp: string; apyBase: number | null; tvlUsd: number | null }[];
  };
  const volumeBody = await volumeResponse.json() as {
    data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } };
  };
  if (body.status !== "success") throw new Error(`DefiLlama ${pool.id}: failed response`);
  const volumeByDate = new Map<string, number>();
  for (const candle of volumeBody.data.attributes.ohlcv_list) {
    const date = new Date(candle[0] * 1000).toISOString().slice(0, 10);
    if (date >= from && date <= through && Number.isFinite(candle[5])) {
      volumeByDate.set(date, candle[5]);
    }
  }
  const byDate = new Map<string, Observation>();
  for (const row of body.data) {
    const date = row.timestamp.slice(0, 10);
    if (date < from || date > through) continue;
    if (!Number.isFinite(row.apyBase) || !Number.isFinite(row.tvlUsd)) continue;
    const volumeUsd = volumeByDate.get(date);
    if (volumeUsd === undefined) continue;
    byDate.set(date, {
      date, apyBasePct: row.apyBase!, tvlUsd: row.tvlUsd!,
      volumeUsd, grossPoolFeesUsd: volumeUsd * pool.feeRate,
    });
  }
  const observations = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (observations.length < 170) throw new Error(`${pool.id}: only ${observations.length} aligned daily observations`);
  return { id: pool.id, observations };
}));

const snapshot: Snapshot = {
  source: "DefiLlama Yields API + GeckoTerminal OHLCV API",
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
