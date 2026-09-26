import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app";

test("first start seeds research data and serves backtests and premium tiers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nacre-api-"));
  const app = buildApp(join(directory, "research.sqlite"));
  try {
    const pools = await app.inject({ method: "GET", url: "/api/pools" });
    expect(pools.statusCode).toBe(200);
    expect(pools.json()).toHaveLength(3);

    const backtest = await app.inject({ method: "GET", url: "/api/pools/usdc-weth-005/backtest?principalUsd=100000" });
    expect(backtest.statusCode).toBe(200);
    expect(backtest.json().windowCount).toBeGreaterThan(0);

    const quotes = await app.inject({ method: "GET", url: "/api/pools/usdc-weth-005/quotes?principalUsd=100000" });
    expect(quotes.statusCode).toBe(200);
    expect(quotes.json().quotes.length).toBeGreaterThan(0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
