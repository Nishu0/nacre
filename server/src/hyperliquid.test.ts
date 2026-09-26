import { expect, test } from "bun:test";
import { parseCandles } from "./hyperliquid";
import { buildApp } from "./app";
import { parseEthTrades } from "../../frontend/src/lib/use-hyperliquid-price";

const now = 1_800_000_030_000;
test("ETH candles use closing prices and never date an open candle in the future", () => {
  const candle = { s: "ETH", i: "1m", t: now - 30_000, T: now + 29_999, c: "2688.42" };
  const points = parseCandles([
    candle, { ...candle, s: "BTC", c: "99000" }, { ...candle, c: "NaN" },
    { ...candle, t: now - 90_000, T: now - 30_001, c: "2687.1" },
  ], now);
  expect(points).toEqual([
    { timestamp: new Date(now - 30_001).toISOString(), priceUsdc: 2687.1 },
    { timestamp: new Date(now).toISOString(), priceUsdc: 2688.42 },
  ]);
  expect(() => parseCandles([{ ...candle, c: "0" }], now)).toThrow();
});

test("stream accepts only recent ETH trades and orders exchange timestamps", () => {
  expect(parseEthTrades([
    { coin: "ETH", time: now, px: "2688.2" },
    { coin: "ETH", time: now - 500, px: "2688.1" },
    { coin: "BTC", time: now, px: "99999" },
    { coin: "ETH", time: now - 100_000, px: "2000" },
    { coin: "ETH", time: now + 10_000, px: "2000" },
    { coin: "ETH", time: now, px: "NaN" }, null,
  ], now).map((point) => point.priceUsdc)).toEqual([2688.1, 2688.2]);
  expect(parseEthTrades({ mids: {} }, now)).toEqual([]);
});

test("history outage is explicit and never falls back to old Pyth observations", async () => {
  const app = buildApp(":memory:", undefined, async () => { throw new Error("offline"); });
  try {
    const response = await app.inject({ method: "GET", url: "/api/live-price-history" });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: string }>().error).toBe("Hyperliquid price history is unavailable.");
  } finally { await app.close(); }
});
