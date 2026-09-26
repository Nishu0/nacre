import { dailyFeeEstimate, rollingWindows, roundUsd } from "./backtest";
import type { Observation } from "./market-data";

export function buildRiskAnalysis(observations: Observation[], depositUsd: number,
  feeFloorUsd: number, payoutCapUsd: number) {
  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const windows = rollingWindows(sorted, depositUsd);
  if (!windows.length) throw new Error("At least 30 daily observations are required");

  const shortfalls = windows.map((window) =>
    Math.min(payoutCapUsd, Math.max(0, feeFloorUsd - window.feesUsd)));
  const breached = shortfalls.filter((value) => value > 0);
  const averagePayout = shortfalls.reduce((sum, value) => sum + value, 0) / shortfalls.length;
  const conditionalPayout = breached.length
    ? breached.reduce((sum, value) => sum + value, 0) / breached.length : 0;

  const months = new Map<string, {
    month: string; days: number; modeledFeesUsd: number; grossPoolFeesUsd: number;
    volumeUsd: number; tvlSumUsd: number; apySumPct: number;
  }>();
  for (const day of sorted) {
    const month = day.date.slice(0, 7);
    const row = months.get(month) ?? {
      month, days: 0, modeledFeesUsd: 0, grossPoolFeesUsd: 0,
      volumeUsd: 0, tvlSumUsd: 0, apySumPct: 0,
    };
    row.days++;
    row.modeledFeesUsd += dailyFeeEstimate(depositUsd, day.apyBasePct);
    row.grossPoolFeesUsd += day.grossPoolFeesUsd;
    row.volumeUsd += day.volumeUsd;
    row.tvlSumUsd += day.tvlUsd;
    row.apySumPct += day.apyBasePct;
    months.set(month, row);
  }

  return {
    sampleFrom: sorted[0].date,
    sampleThrough: sorted.at(-1)!.date,
    sampleDays: sorted.length,
    windowDays: 30,
    windowCount: windows.length,
    depositUsd,
    feeFloorUsd,
    payoutCapUsd,
    shortfallWindows: breached.length,
    shortfallFrequencyPct: Math.round(breached.length / windows.length * 1000) / 10,
    historicalAveragePayoutUsd: roundUsd(averagePayout),
    averagePayoutWhenShortUsd: roundUsd(conditionalPayout),
    worstHistoricalPayoutUsd: roundUsd(Math.max(...shortfalls)),
    lowest30DayFeesUsd: roundUsd(Math.min(...windows.map((window) => window.feesUsd))),
    latest30DayFeesUsd: roundUsd(windows.at(-1)!.feesUsd),
    monthly: [...months.values()].map((row) => ({
      month: row.month,
      days: row.days,
      modeledFeesUsd: roundUsd(row.modeledFeesUsd),
      grossPoolFeesUsd: roundUsd(row.grossPoolFeesUsd),
      volumeUsd: roundUsd(row.volumeUsd),
      averageTvlUsd: roundUsd(row.tvlSumUsd / row.days),
      averageBaseApyPct: Math.round(row.apySumPct / row.days * 100) / 100,
    })),
  };
}
