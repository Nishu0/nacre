import { expect, test } from "bun:test";
import { indicativeQuotes, rollingWindows } from "./backtest";
import type { Observation } from "./market-data";

const observations: Observation[] = Array.from({ length: 35 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
  apyBasePct: index < 30 ? 7.3 : 3.65,
  tvlUsd: 1_000_000,
  volumeUsd: 100_000,
  grossPoolFeesUsd: 50,
}));

test("30-day windows sum fee yield and reject gaps", () => {
  const windows = rollingWindows(observations, 10_000);
  expect(windows).toHaveLength(6);
  expect(windows[0].feesUsd).toBeCloseTo(60);
  expect(rollingWindows(observations.filter((_, index) => index !== 10), 10_000)).toHaveLength(0);
});

test("higher floor increases expected payout and indicative premium", () => {
  const { quotes } = indicativeQuotes(observations, 10_000);
  expect(quotes[1].feeFloorUsd).toBeGreaterThan(quotes[0].feeFloorUsd);
  expect(quotes[1].indicativePremiumUsd).toBeGreaterThan(quotes[0].indicativePremiumUsd);
  expect(quotes[1].payoutCapUsd).toBeGreaterThan(quotes[0].payoutCapUsd);
});
