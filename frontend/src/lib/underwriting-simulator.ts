export type YieldDay = { date: string; apyBasePct: number };
export type SimulationInput = {
  principal: number; capital: number; days: number; cap: number; premiumPct: number;
  lossBudget: number; positionLimit: number; lpFeeBudgetPct: number;
  spot: number; lower: number; upper: number; shockPct: number; stressWeightPct: number;
};

// Scenario analysis, not an inferred probability model for concentrated liquidity.
export function simulateUnderwriting(history: YieldDay[], input: SimulationInput) {
  const x = input;
  if (Object.values(x).some((value) => !Number.isFinite(value))
    || x.principal <= 0 || x.capital < 0 || x.cap <= 0 || x.lossBudget < 0
    || !Number.isInteger(x.days) || x.days < 1 || x.days > 90
    || !Number.isInteger(x.positionLimit) || x.positionLimit < 0
    || x.spot <= 0 || x.lower <= 0 || x.upper <= x.lower
    || x.premiumPct < 0 || x.premiumPct > 100
    || x.lpFeeBudgetPct < 0 || x.lpFeeBudgetPct > 100
    || x.stressWeightPct < 0 || x.stressWeightPct > 100 || x.shockPct <= -100) {
    throw new Error("Enter valid amounts, ordered price bounds, and percentages between 0 and 100.");
  }
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.some((row) => !Number.isFinite(row.apyBasePct) || row.apyBasePct < 0)) {
    throw new Error("Yield history contains invalid observations.");
  }
  const within = (price: number) => price >= x.lower && price < x.upper;
  const inRange = within(x.spot);
  // Linear stress path over the chosen term; midpoint daily sampling misses
  // intraday excursions. No claim that this path was observed historically.
  const active = Array.from({ length: x.days }, (_, day) =>
    within(x.spot * (1 + x.shockPct / 100 * (day + .5) / x.days)));
  const windows: { base: number; stress: number }[] = [];
  for (let start = 0; start + x.days <= sorted.length; start++) {
    const rows = sorted.slice(start, start + x.days);
    if (rows.some((row, i) => !Number.isFinite(Date.parse(row.date))
      || (i > 0 && Date.parse(row.date) - Date.parse(rows[i - 1].date) !== 86_400_000))) continue;
    const fees = rows.map((row) => x.principal * row.apyBasePct / 100 / 365);
    windows.push({ base: fees.reduce((a, b) => a + b, 0),
      stress: fees.reduce((total, fee, i) => total + (active[i] ? fee * .8 : 0), 0) });
  }
  if (!windows.length) throw new Error("Not enough consecutive daily observations for this duration.");
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const payout = (fees: number) => Math.max(0, x.cap - fees);
  const weight = x.stressWeightPct / 100;
  const expectedPayout = mean(windows.map((row) =>
    payout(inRange ? row.base : 0) * (1 - weight) + payout(row.stress) * weight));
  const premium = Math.ceil(x.cap * x.premiumPct / 100 * 1e6) / 1e6;
  const lossPerPosition = Math.max(0, x.cap - premium);
  const collateralLimit = Math.floor(x.capital / x.cap);
  const riskLimit = lossPerPosition > 0 ? Math.floor(x.lossBudget / lossPerPosition) : collateralLimit;
  const count = Math.max(0, Math.min(collateralLimit, riskLimit, x.positionLimit));
  const recent = windows.at(-1)!.base;
  const latest = sorted.at(-1)!;
  const currentRunRate = x.principal * latest.apyBasePct / 100 * x.days / 365;
  const lpPremiumCeiling = Math.min(recent, currentRunRate) * x.lpFeeBudgetPct / 100;
  const minimumPremium = expectedPayout * 1.2 + x.cap * .01;
  // Preview only: the contract uses an NFT's conservative endpoint inventory
  // valued by its oracle, which can produce a LOWER limit than input principal.
  const indicativeContractCap = x.principal * .2 * x.days / 365;
  const researchCap = Math.max(...windows.map((row) => row.base)) * .9;
  const capWithinLimits = x.cap <= Math.min(researchCap, indicativeContractCap);
  const feasible = inRange && capWithinLimits && minimumPremium <= lpPremiumCeiling;
  const scenarios = [
    { name: "Recent fee window · stays in range", fees: recent },
    { name: "Assumed price move + 20% fee haircut", fees: windows.at(-1)!.stress },
    { name: "Every covered LP earns zero fees", fees: 0 },
  ].map(({ name, fees }) => ({ name, fees, payout: payout(fees),
    lpNet: fees + payout(fees) - premium, uninsuredNet: fees,
    underwriterNet: count * (premium - payout(fees)) }));
  return { windowCount: windows.length, sampleDays: sorted.length, latestDate: latest.date,
    latestApy: latest.apyBasePct, currentRunRate, recent, expectedPayout, premium,
    minimumPremium, lpPremiumCeiling, count, collateralLimit, riskLimit,
    reserved: count * x.cap, idle: x.capital - count * x.cap,
    premiums: count * premium, expectedNet: count * (premium - expectedPayout),
    worstLoss: count * lossPerPosition, lossPerPosition, scenarios, inRange, feasible,
    capWithinLimits, researchCap, indicativeContractCap,
    inRangeDays: active.filter(Boolean).length,
    premiumAcceptable: feasible && premium >= minimumPremium && premium <= lpPremiumCeiling,
  };
}
