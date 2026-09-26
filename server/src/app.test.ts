import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app";

test("first start seeds research data and serves backtests and premium tiers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nacre-api-"));
  const app = buildApp(join(directory, "research.sqlite"), undefined, async () => ({
    source: "Hyperliquid", points: [{ timestamp: new Date().toISOString(), priceUsdc: 2700 }],
  }));
  try {
    const pools = await app.inject({ method: "GET", url: "/api/pools" });
    expect(pools.statusCode).toBe(200);
    expect(pools.json()).toHaveLength(3);

    const prices = await app.inject({ method: "GET", url: "/api/live-price-history" });
    expect(prices.statusCode).toBe(200);
    expect(prices.json().source).toBe("Hyperliquid");
    expect(prices.json().points).toHaveLength(1);

    const backtest = await app.inject({ method: "GET", url: "/api/pools/usdc-weth-005/backtest?principalUsd=100000" });
    expect(backtest.statusCode).toBe(200);
    expect(backtest.json().windowCount).toBeGreaterThan(0);
    expect(backtest.json().sampleDays).toBe(180);
    expect(backtest.json().daily).toHaveLength(90);
    expect(backtest.json().volume90dUsd).toBeGreaterThan(1_000_000_000);
    expect(backtest.json().grossPoolFees90dUsd).toBeGreaterThan(1_000_000);

    const quotes = await app.inject({ method: "GET", url: "/api/pools/usdc-weth-005/quotes?principalUsd=100000" });
    expect(quotes.statusCode).toBe(200);
    expect(quotes.json().quotes.length).toBeGreaterThan(0);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("live-position feed excludes sandbox LP deposits and underwriting pledges", async () => {
  const app = buildApp(":memory:");
  try {
    const created = await app.inject({ method: "POST", url: "/api/markets", payload: {
      creator: "participant-model", priceUsd: 2000, lowerPriceUsd: 1800,
      upperPriceUsd: 2200, liquidityTargetUsd: 1000, collateralBudgetUsd: 100,
    } });
    const marketId = created.json().market.id as string;
    await app.inject({ method: "POST", url: `/api/markets/${marketId}/pledges`,
      payload: { participant: "participant-maker", amountUsd: 200 } });
    await app.inject({ method: "POST", url: `/api/markets/${marketId}/positions`,
      payload: { participant: "participant-model", amountUsd: 1000, requestCover: false } });

    const publicFeed = await app.inject({ method: "GET", url: "/api/chain-positions" });
    const marketFeed = await app.inject({ method: "GET", url: `/api/chain-positions?marketId=${marketId}` });
    expect(publicFeed.statusCode).toBe(200);
    expect(publicFeed.json().positions).toEqual([]);
    expect(marketFeed.json().positions).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/api/chain-positions?account=invalid" })).statusCode).toBe(400);
  } finally { await app.close(); }
});

test("fee request preview follows duration and caps the target below historical best", async () => {
  const app = buildApp(":memory:");
  try {
    const created = await app.inject({ method: "POST", url: "/api/markets", payload: {
      creator: "participant-fees", priceUsd: 2000, lowerPriceUsd: 1800,
      upperPriceUsd: 2200, liquidityTargetUsd: 1000, collateralBudgetUsd: 100,
    } });
    const marketId = created.json().market.id as string;
    const short = await app.inject({ method: "GET", url: `/api/markets/${marketId}/fee-request?depositUsd=1000&days=7` });
    const long = await app.inject({ method: "GET", url: `/api/markets/${marketId}/fee-request?depositUsd=1000&days=30` });
    expect(short.statusCode).toBe(200);
    expect(long.statusCode).toBe(200);
    expect(short.json().windowDays).toBe(7);
    expect(long.json().windowDays).toBe(30);
    expect(short.json().maximumFeeTargetUsd).toBeLessThanOrEqual(short.json().bestFeesUsd);
    expect(long.json().maximumFeeTargetUsd).toBeGreaterThan(short.json().maximumFeeTargetUsd);
    const tooHigh = await app.inject({ method: "GET", url:
      `/api/markets/${marketId}/fee-request?depositUsd=1000&days=7&feeTargetUsd=${short.json().bestFeesUsd}` });
    expect(tooHigh.statusCode).toBe(400);
    const custom = await app.inject({ method: "GET", url:
      `/api/markets/${marketId}/fee-request?depositUsd=1000&days=7&feeTargetUsd=1` });
    expect(custom.statusCode).toBe(200);
    expect(custom.json().feeTargetUsd).toBe(1);
  } finally { await app.close(); }
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

    const risk = await app.inject({ method: "GET",
      url: `/api/markets/${marketId}/risk?depositUsd=10000` });
    expect(risk.statusCode).toBe(200);
    expect(risk.json().mode).toBe("research");
    expect(risk.json().referencePool.id).toBe("usdc-weth-005");
    expect(risk.json().analysis.sampleDays).toBe(180);
    expect(risk.json().analysis.windowCount).toBe(151);
    expect(risk.json().analysis.monthly.length).toBeGreaterThan(5);
    expect(risk.json().analysis.payoutCapUsd).toBe(before.payoutCapUsd);
    expect(risk.json().quote.premiumUsd).toBe(before.premiumUsd);
    expect((await app.inject({ method: "GET",
      url: `/api/markets/${marketId}/risk?depositUsd=0` })).statusCode).toBe(400);

    const pledge = await app.inject({ method: "POST", url: `/api/markets/${marketId}/pledges`,
      payload: { participant: "participant-maker", amountUsd: 200 } });
    expect(pledge.statusCode).toBe(201);
    const underwriting = await app.inject({ method: "GET", url: "/api/underwriting?participant=participant-maker" });
    expect(underwriting.json().pledges).toMatchObject([{ marketId, capacityUsd: 200 }]);
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
    const priceHistory = await app.inject({ method: "GET", url: `/api/markets/${marketId}/price-history` });
    expect(priceHistory.json().events.map((event: { priceUsd: number }) => event.priceUsd))
      .toEqual([2000, 2250]);
    const after = (await app.inject({ method: "GET", url: quoteUrl })).json().quote;
    expect(after.available).toBe(false);
    expect(after.reasons[0]).toContain("outside");
    const rejected = await app.inject({ method: "POST", url: `/api/markets/${marketId}/positions`,
      payload: { participant, amountUsd: 1000, requestCover: true } });
    expect(rejected.statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: `/api/portfolio?participant=${participant}` })).json().positions).toHaveLength(1);
  } finally { await app.close(); }
});

test("live quote can explicitly move a sandbox tick without mixing chart sources", async () => {
  const publishedAt = new Date().toISOString();
  const live = {
    source: "Pyth" as const, network: "Pyth Core", sourceUrl: "https://www.pyth.network/price-feeds",
    fetchedAt: publishedAt,
    assets: { WETH: { usd: 2700, publishedAt }, USDC: { usd: 1, publishedAt } },
    wethUsdc: 2700,
  };
  const app = buildApp(":memory:", async () => live, async () => ({
    source: "Hyperliquid", points: [{ timestamp: publishedAt, priceUsdc: 2699 }],
  }));
  try {
    const created = await app.inject({ method: "POST", url: "/api/markets", payload: {
      creator: "participant-oracle", priceUsd: 2000, lowerPriceUsd: 1800,
      upperPriceUsd: 2200, liquidityTargetUsd: 1000, collateralBudgetUsd: 100,
    } });
    const marketId = created.json().market.id as string;
    const current = await app.inject({ method: "GET", url: "/api/live-prices" });
    expect(current.json().source).toBe("Pyth");
    const history = await app.inject({ method: "GET", url: "/api/live-price-history" });
    expect(history.json().source).toBe("Hyperliquid");
    expect(history.json().points.at(-1).priceUsdc).toBe(2699);
    const synced = await app.inject({ method: "POST", url: `/api/markets/${marketId}/oracle-sync` });
    expect(synced.statusCode).toBe(200);
    expect(synced.json().market.priceUsd).toBe(2700);
    expect(synced.json().market.inRange).toBe(false);
    expect(synced.json().source).toBe("Pyth");
  } finally { await app.close(); }
});

test("position ranges and maker premiums persist while deployment stays gated", async () => {
  const app = buildApp(":memory:");
  try {
    const created = await app.inject({ method: "POST", url: "/api/markets", payload: {
      creator: "participant-range", priceUsd: 2000, lowerPriceUsd: 1800,
      upperPriceUsd: 2200, liquidityTargetUsd: 1000, collateralBudgetUsd: 100,
    } });
    const marketId = created.json().market.id as string;
    const base = (await app.inject({ method: "GET", url: `/api/markets/${marketId}/quote?depositUsd=1000` })).json().quote;
    const narrow = (await app.inject({ method: "GET",
      url: `/api/markets/${marketId}/quote?depositUsd=1000&lowerPriceUsd=1950&upperPriceUsd=2050` })).json().quote;
    expect(narrow.lowerPriceUsd).toBe(1950);
    expect(narrow.upperPriceUsd).toBe(2050);
    expect(narrow.split.ethPercent).not.toBe(base.split.ethPercent);
    expect((await app.inject({ method: "GET",
      url: `/api/markets/${marketId}/quote?depositUsd=1000&lowerPriceUsd=1700&upperPriceUsd=2050` })).statusCode).toBe(400);

    const pledge = await app.inject({ method: "POST", url: `/api/markets/${marketId}/pledges`,
      payload: { participant: "participant-maker", amountUsd: 150, premiumUsd: 2.5, exampleDepositUsd: 1000 } });
    expect(pledge.statusCode).toBe(201);
    const proposals = (await app.inject({ method: "GET", url: "/api/underwriting?participant=participant-maker" })).json().pledges;
    expect(proposals[0]).toMatchObject({ premiumUsd: 2.5, exampleDepositUsd: 1000 });

    const deposit = await app.inject({ method: "POST", url: `/api/markets/${marketId}/positions`,
      payload: { participant: "participant-range", amountUsd: 1000, requestCover: false,
        lowerPriceUsd: 1950, upperPriceUsd: 2050 } });
    expect(deposit.statusCode).toBe(201);
    const position = (await app.inject({ method: "GET", url: "/api/portfolio?participant=participant-range" })).json().positions[0];
    expect(position).toMatchObject({ lowerPriceUsd: 1950, upperPriceUsd: 2050 });
    expect((await app.inject({ method: "POST", url: `/api/markets/${marketId}/deployment`,
      payload: { txHash: `0x${"0".repeat(64)}` } })).statusCode).toBe(409);
  } finally { await app.close(); }
});
