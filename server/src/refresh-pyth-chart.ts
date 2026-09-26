import { writeFileSync } from "node:fs";

const key = process.env.PYTH_API_KEY?.trim();
if (!key) throw new Error("Set PYTH_API_KEY in server/.env before refreshing Pyth chart history");

const ids = [
  "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
];
const lastHour = Math.floor(Date.now() / 3_600_000) * 3600 - 3600;
const points: [string, number][] = [];

for (let hoursAgo = 23; hoursAgo >= 0; hoursAgo--) {
  const timestamp = lastHour - hoursAgo * 3600;
  const url = new URL(`https://benchmarks.pyth.network/v1/updates/price/${timestamp}`);
  for (const id of ids) url.searchParams.append("ids[]", id);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Pyth Benchmarks HTTP ${response.status} at ${timestamp}`);
  const body = await response.json() as { parsed?: { id: string; price: {
    price: string; expo: number; publish_time: number;
  } }[] };
  const quotes = ids.map((id) => body.parsed?.find((feed) =>
    feed.id.toLowerCase() === id.slice(2)));
  if (quotes.some((quote) => !quote)) throw new Error(`Missing Pyth feed at ${timestamp}`);
  const values = quotes.map((quote) => {
    const price = quote!.price;
    if (Math.abs(price.publish_time - timestamp) > 120) throw new Error("Historical update is too far from requested time");
    return Number(price.price) * 10 ** price.expo;
  });
  const wethUsdc = values[0] / values[1];
  if (!Number.isFinite(wethUsdc) || wethUsdc <= 0) throw new Error("Invalid historical WETH/USDC price");
  points.push([new Date(timestamp * 1000).toISOString(), wethUsdc]);
  // Benchmarks permits 10 requests per 10 seconds. Stay under that limit.
  if (hoursAgo > 0) await Bun.sleep(1100);
}

writeFileSync(new URL("../data/pyth-weth-history.json", import.meta.url), JSON.stringify({
  source: "Pyth Benchmarks ETH/USD divided by USDC/USD, hourly samples",
  capturedAt: new Date().toISOString(),
  points,
}, null, 2) + "\n");
console.log(`Saved ${points.length} Pyth hourly WETH/USDC reference prices`);
