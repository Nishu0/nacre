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

test("sandbox funding, position coverage, and tick exit remain capacity bounded", async () => {
  const app = buildApp(":memory:");
  const participant = "participant-alice";
  try {
    const created = await app.inject({ method: "POST", url: "/api/markets", payload: {
      creator: participant, priceUsd: 2000, lowerPriceUsd: 1800,
      upperPriceUsd: 2200, liquidityTargetUsd: 1000, collateralBudgetUsd: 100,
    } });
    expect(created.statusCode).toBe(201);
    const marketId = created.json().market.id as string;
    const quoteUrl = `/api/markets/${marketId}/quote?depositUsd=10000`;
    const before = (await app.inject({ method: "GET", url: quoteUrl })).json().quote;
    expect(before.available).toBe(false);
    expect(before.split.ethPercent).toBeGreaterThan(0);
    expect(before.split.ethPercent).toBeLessThan(100);

    const pledge = await app.inject({ method: "POST", url: `/api/markets/${marketId}/pledges`,
      payload: { participant: "participant-maker", amountUsd: 200 } });
    expect(pledge.statusCode).toBe(201);
    const invested = await app.inject({ method: "POST", url: `/api/markets/${marketId}/positions`,
      payload: { participant, amountUsd: 10000, requestCover: true } });
    expect(invested.statusCode).toBe(201);
    expect(invested.json().market.funded).toBe(true);
    const portfolio = await app.inject({ method: "GET", url: `/api/portfolio?participant=${participant}` });
    expect(portfolio.json().positions[0].insured).toBe(true);
    expect(portfolio.json().positions[0].payoutCapUsd).toBeGreaterThan(0);

    const moved = await app.inject({ method: "PATCH", url: `/api/markets/${marketId}/price`,
      payload: { priceUsd: 2250 } });
    expect(moved.json().market.inRange).toBe(false);
    const after = (await app.inject({ method: "GET", url: quoteUrl })).json().quote;
    expect(after.available).toBe(false);
    expect(after.reasons[0]).toContain("outside");
    const rejected = await app.inject({ method: "POST", url: `/api/markets/${marketId}/positions`,
      payload: { participant, amountUsd: 1000, requestCover: true } });
    expect(rejected.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/api/portfolio?participant=${participant}` })).json().positions).toHaveLength(1);
  } finally { await app.close(); }
});
