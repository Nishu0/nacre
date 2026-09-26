import type { YieldDay } from "./underwriting-simulator";
export type PoolActivity = { price: number; tvl: number; feePct: number; swaps: number; syntheticSwaps: number; grossFees: number; syntheticFees: number; baseApr: number | null; organicApr: number | null; hours: number; low: number; high: number; capturedAt: string; methodology: string };
export function bidGuidance(history: YieldDay[], principal: number, cap: number, days: number, activity?: PoolActivity | null, includeTest = false) {
  if (![principal, cap, days].every(Number.isFinite) || principal <= 0 || cap <= 0 || !Number.isInteger(days) || days < 1 || days > 90) return null;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const fees: number[] = [];
  for (let i = 0; i + days <= sorted.length; i++) {
    const rows = sorted.slice(i, i + days);
    if (rows.some((r, j) => !Number.isFinite(r.apyBasePct) || r.apyBasePct < 0 || (j && Date.parse(r.date) - Date.parse(rows[j - 1].date) !== 86400000))) continue;
    fees.push(rows.reduce((n, r) => n + principal * r.apyBasePct / 100 * 1 / 365, 0));
  }
  fees.sort((a, b) => a - b);
  if (!fees.length) return null;
  const median = fees[Math.floor(fees.length / 2)];
  const measuredApr = activity && (activity.hours >= 1 || includeTest) && activity.swaps >= 10 ? (includeTest ? activity.baseApr : activity.organicApr) : null;
  const budget = measuredApr !== null && measuredApr !== undefined ? Math.min(median, principal * measuredApr / 100 * days / 365) : median;
  const feeScale = median > 0 ? Math.min(1, budget / median) : 1;
  const expectedClaim = fees.map((fee) => fee * feeScale).reduce((n, fee) => n + Math.min(cap, Math.max(0, cap - fee)), 0) / fees.length;
  // Explicit pricing assumptions: 20% loading on mean historical claims + 1% of cap.
  const requiredPct = (expectedClaim * 1.2 + cap * .01) / cap * 100;
  const suggestedPct = Math.min(100, Math.max(.01, Math.ceil(requiredPct * 100) / 100));
  // LP affordability budget: spend at most 20% of modeled gross fees on premium.
  const affordablePct = Math.min(100, budget * .2 / cap * 100);
  return { median, best: fees.at(-1)!, budget, expectedClaim, requiredPct, suggestedPct, affordablePct, feasible: requiredPct <= affordablePct, recommendedCap: Math.min(budget, principal * .2 * days / 365), windows: fees.length };
}
export const maximumSpots = (capital: string, cap: string) => {
  const a = Number(capital), b = Number(cap);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? Math.min(100, Math.floor(Math.round(a * 1e6) / Math.round(b * 1e6))) : 0;
};
