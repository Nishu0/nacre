import type { Observation } from "./market-data";

export type WindowResult = { start: string; end: string; feesUsd: number };

// DefiLlama's apyBase is a pool-level annualized base yield. This is a simple
// dollar exposure model, not the observed P&L of a concentrated LP position.
export function dailyFeeEstimate(principalUsd: number, apyBasePct: number): number {
  return (principalUsd * apyBasePct) / 100 / 365;
}

export function rollingWindows(
  observations: Observation[],
  principalUsd: number,
  days = 30,
): WindowResult[] {
  if (!Number.isFinite(principalUsd) || principalUsd <= 0) throw new Error("Invalid principal");
  if (!Number.isInteger(days) || days < 1) throw new Error("Invalid window");

  const sorted = [...observations].sort((a, b) => a.date.localeCompare(b.date));
  const results: WindowResult[] = [];
  for (let i = 0; i + days <= sorted.length; i++) {
    const window = sorted.slice(i, i + days);
    const first = Date.parse(`${window[0].date}T00:00:00Z`);
    const last = Date.parse(`${window.at(-1)!.date}T00:00:00Z`);
    if (last - first !== (days - 1) * 86_400_000) continue;
    const feesUsd = window.reduce(
      (sum, row) => sum + dailyFeeEstimate(principalUsd, row.apyBasePct),
      0,
    );
    results.push({ start: window[0].date, end: window.at(-1)!.date, feesUsd });
  }
  return results;
}

export function roundUsd(value: number): number {
  return Math.round(value * 100) / 100;
}

export function feeRequestPreview(
  observations: Observation[], principalUsd: number, windowDays: number,
  requestedFloorUsd?: number,
) {
  const windows = rollingWindows(observations, principalUsd, windowDays);
  if (!windows.length) throw new Error("Not enough consecutive observations for this duration");
  const fees = windows.map((window) => window.feesUsd);
  const recent = fees.at(-1)!;
  const best = Math.max(...fees);
  // Keep a requested minimum below the best observed window. This is a
  // research guardrail, not an offer of insurance or a guarantee of fees.
  const maximum = roundUsd(best * 0.9);
  const suggested = roundUsd(Math.min(recent, maximum));
  const target = requestedFloorUsd === undefined ? suggested : requestedFloorUsd;
  if (!Number.isFinite(target) || target < 0.01 || target > maximum) {
    throw new Error(`Minimum fee target must be between $0.01 and $${maximum.toFixed(2)}`);
  }
  const shortfalls = fees.map((fee) => Math.max(0, target - fee));
  const stressed = fees.map((fee) => Math.max(0, target - fee * 0.8));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const expectedPayout = mean(shortfalls) * 0.75 + mean(stressed) * 0.25;
  return {
    principalUsd, windowDays, sampleDays: observations.length, windowCount: windows.length,
    recentFeesUsd: roundUsd(recent), bestFeesUsd: roundUsd(best),
    maximumFeeTargetUsd: maximum, suggestedFeeTargetUsd: suggested,
    feeTargetUsd: roundUsd(target),
    indicativePremiumUsd: roundUsd(expectedPayout * 1.2 + target * 0.01),
    method: "Pool-level base APY applied to the modeled deposit. The maximum fee target is 90% of the best observed window. A concentrated position can earn more, less, or zero; no coverage is available until collateral is locked on-chain.",
  };
}

export function backtest(observations: Observation[], principalUsd: number) {
  const windows = rollingWindows(observations, principalUsd);
  if (!windows.length) throw new Error("At least 30 consecutive daily observations are required");
  const latest90 = [...observations].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  const daily = latest90.map((row) => ({
    date: row.date,
    volumeUsd: roundUsd(row.volumeUsd),
    grossPoolFeesUsd: roundUsd(row.grossPoolFeesUsd),
    modeledPositionFeesUsd: roundUsd(dailyFeeEstimate(principalUsd, row.apyBasePct)),
    tvlUsd: roundUsd(row.tvlUsd),
  }));
  const sum = (key: "volumeUsd" | "grossPoolFeesUsd" | "modeledPositionFeesUsd") =>
    roundUsd(daily.reduce((total, row) => total + row[key], 0));
  const orderedVolume = daily.map((row) => row.volumeUsd).sort((a, b) => a - b);
  const fees = windows.map((window) => window.feesUsd);
  const best = windows.reduce((a, b) => (a.feesUsd >= b.feesUsd ? a : b));
  const worst = windows.reduce((a, b) => (a.feesUsd <= b.feesUsd ? a : b));
  const recent = windows.at(-1)!;
  return {
    principalUsd,
    sampleDays: observations.length,
    yieldHistory: observations.map(({ date, apyBasePct }) => ({ date, apyBasePct })),
    windowDays: 30,
    windowCount: windows.length,
    displayedDays: daily.length,
    daily,
    volume90dUsd: sum("volumeUsd"),
    grossPoolFees90dUsd: sum("grossPoolFeesUsd"),
    modeledPositionFees90dUsd: sum("modeledPositionFeesUsd"),
    medianDailyVolumeUsd: roundUsd(orderedVolume[Math.floor(orderedVolume.length / 2)]),
    recent: { ...recent, feesUsd: roundUsd(recent.feesUsd) },
    best: { ...best, feesUsd: roundUsd(best.feesUsd) },
    worst: { ...worst, feesUsd: roundUsd(worst.feesUsd) },
    windows: windows.map((window) => ({ ...window, feesUsd: roundUsd(window.feesUsd) })),
  };
}

export function indicativeQuotes(observations: Observation[], principalUsd: number) {
  const results = backtest(observations, principalUsd);
  const rawWindows = rollingWindows(observations, principalUsd);
  const recent = rawWindows.at(-1)!.feesUsd;
  const best = Math.max(...rawWindows.map((window) => window.feesUsd));
  const tiers = [
    { id: "current", label: "Current 30-day run rate", floor: recent },
    { id: "stretch", label: "98% of historical best 30 days", floor: best * 0.98 },
  ].filter((tier) => tier.id === "current" || tier.floor > recent);

  return {
    ...results,
    quotes: tiers.map((tier) => {
      const floor = tier.floor;
      // A genuine minimum fee-income promise needs enough collateral to cover
      // the whole shortfall if the position earns zero eligible fees.
      const payoutCap = floor;
      const payouts = rawWindows.map((window) =>
        Math.min(Math.max(floor - window.feesUsd, 0), payoutCap),
      );
      const stressedPayouts = rawWindows.map((window) =>
        Math.min(Math.max(floor - window.feesUsd * 0.8, 0), payoutCap),
      );
      const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
      const historicalExpectedPayout = mean(payouts);
      const stressExpectedPayout = mean(stressedPayouts);
      const modeledExpectedPayout = historicalExpectedPayout * 0.75 + stressExpectedPayout * 0.25;
      const premium = modeledExpectedPayout * 1.2 + payoutCap * 0.01;
      return {
        id: tier.id,
        label: tier.label,
        feeFloorUsd: roundUsd(floor),
        payoutCapUsd: roundUsd(payoutCap),
        historicalExpectedPayoutUsd: roundUsd(historicalExpectedPayout),
        stressedExpectedPayoutUsd: roundUsd(stressExpectedPayout),
        indicativePremiumUsd: roundUsd(premium),
        minimumNetFeesAfterPremiumUsd: roundUsd(floor - premium),
        payoutWindowCount: payouts.filter((value) => value > 0).length,
      };
    }),
    pricingMethod: "75% historical 30-day shortfalls + 25% shortfalls after a 20% fee haircut; 20% risk margin on blended expected payout + 1% of payout cap as capital charge. Indicative only; underwriters set executable prices.",
  };
}
