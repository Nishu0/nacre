// ETH perpetual trade prices are market references, not Uniswap execution prices.
export type PricePoint = { timestamp: string; priceUsdc: number };
export type PriceHistory = { source: "Hyperliquid"; points: PricePoint[] };

export function parseCandles(body: unknown, now = Date.now()): PricePoint[] {
  if (!Array.isArray(body)) throw new Error("Invalid Hyperliquid candles");
  const points = new Map<string, number>();
  for (const item of body) {
    if (!item || item.s !== "ETH" || item.i !== "1m") continue;
    const price = Number(item.c);
    const open = Number(item.t);
    const close = Number(item.T);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(open)
      || !Number.isFinite(close) || open <= 0 || open > now || close < open) continue;
    points.set(new Date(Math.min(close, now)).toISOString(), price);
  }
  if (!points.size) throw new Error("Hyperliquid returned no ETH prices");
  return [...points].sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, priceUsdc]) => ({ timestamp, priceUsdc }));
}

let cached: { value: PriceHistory; until: number } | undefined;
let inFlight: Promise<PriceHistory> | undefined;

export async function getHyperliquidHistory(): Promise<PriceHistory> {
  if (cached && Date.now() < cached.until) return cached.value;
  if (!inFlight) inFlight = (async () => {
    const now = Date.now();
    const response = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "candleSnapshot", req: {
        coin: "ETH", interval: "1m", startTime: now - 65 * 60_000, endTime: now,
      } }), signal: AbortSignal.timeout(6000), cache: "no-store",
    });
    if (!response.ok) throw new Error(`Hyperliquid HTTP ${response.status}`);
    const points = parseCandles(await response.json(), now);
    if (now - Date.parse(points.at(-1)!.timestamp) > 90_000) {
      throw new Error("Hyperliquid prices are stale");
    }
    const value: PriceHistory = { source: "Hyperliquid", points };
    cached = { value, until: Date.now() + 5000 };
    return value;
  })().finally(() => { inFlight = undefined; });
  return inFlight;
}
