import { expect, test } from "bun:test";
import { buildRiskAnalysis } from "./risk-analysis";
import type { Observation } from "./market-data";

const observations: Observation[] = Array.from({ length: 60 }, (_, index) => ({
  date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
  apyBasePct: index < 30 ? 3.65 : 7.3,
  tvlUsd: 1_000_000 + index * 100,
  volumeUsd: 100_000,
  grossPoolFeesUsd: 50,
}));

test("risk analysis groups actual sample months and caps rolling shortfalls", () => {
  const result = buildRiskAnalysis(observations, 1_000, 4, 0.5);
  expect(result.sampleFrom).toBe("2024-01-01");
  expect(result.sampleThrough).toBe("2024-02-29");
  expect(result.windowCount).toBe(31);
  expect(result.shortfallWindows).toBe(10);
  expect(result.shortfallFrequencyPct).toBe(32.3);
  expect(result.latest30DayFeesUsd).toBe(6);
  expect(result.lowest30DayFeesUsd).toBe(3);
  expect(result.worstHistoricalPayoutUsd).toBe(0.5);
  expect(result.historicalAveragePayoutUsd).toBe(0.13);
  expect(result.averagePayoutWhenShortUsd).toBe(0.4);
  expect(result.monthly.map(({ month, days, modeledFeesUsd }) => ({ month, days, modeledFeesUsd })))
    .toEqual([
      { month: "2024-01", days: 31, modeledFeesUsd: 3.2 },
      { month: "2024-02", days: 29, modeledFeesUsd: 5.8 },
    ]);
});

test("risk analysis needs a contiguous 30-day sample", () => {
  expect(() => buildRiskAnalysis(observations.slice(0, 29), 1_000, 4, 4)).toThrow();
  expect(() => buildRiskAnalysis(observations.filter((_, index) => index !== 15).slice(0, 30), 1_000, 4, 4)).toThrow();
});
