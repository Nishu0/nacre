import type { BidFundingTerms } from "./bid-profit";
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
  const roundedPct = Math.max(.01, Math.ceil(requiredPct * 100) / 100);
  // LP affordability budget: spend at most 20% of modeled gross fees on premium.
  const affordablePct = Math.min(100, budget * .2 / cap * 100);
  const feasible = roundedPct <= affordablePct && roundedPct < 100;
  const suggestedPct = feasible ? roundedPct : null;
  return { feeScale, median, best: fees.at(-1)!, budget, expectedClaim, requiredPct, suggestedPct, affordablePct, feasible, recommendedCap: Math.min(budget, principal * .2 * days / 365), windows: fees.length };
}
export const maximumSpots = (capital: string, cap: string) => {
  const a = Number(capital), b = Number(cap);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0 ? Math.min(100, Math.floor(Math.round(a * 1e6) / Math.round(b * 1e6))) : 0;
};

// These are transparent product defaults, not an optimized or risk-free quote.
export function automaticBidTerms(history: YieldDay[], terms: BidFundingTerms, activity: PoolActivity | null,
  lower: number, upper: number, includeTest = false, activityError = ""): BidFundingTerms {
  const blocked = (reason: string): BidFundingTerms => ({ ...terms, cap: "", spots: "0", rate: "", quoteIssue: reason });
  if (activityError || !activity || !Number.isFinite(activity.organicApr) || activity.tvl <= 0)
    return blocked("Pool earnings are unavailable. Automatic terms need measured activity.");
  if ((!includeTest && activity.hours < 1) || activity.swaps < 10)
    return blocked("Automatic terms need at least 10 observed swaps and one hour of activity. Generated activity requires demo opt-in.");
  if (![lower, upper].every(Number.isFinite) || lower <= 0 || lower >= upper || activity.price < lower || activity.price >= upper)
    return blocked("Choose a valid range containing the current pool price.");
  const capital = Number(terms.capital), principal = Number(terms.principal ?? "1000");
  if (!Number.isFinite(capital) || capital <= 0 || capital > Number.MAX_SAFE_INTEGER / 1e6)
    return blocked("Enter a valid coverage capital amount.");
  const baseline = bidGuidance(history, principal, 1, terms.days, activity, includeTest);
  if (!baseline) return blocked("Waiting for enough historical fee observations to calculate terms.");
  if (baseline.budget <= 0) return blocked("No supported quote: measured fee earnings are zero. A 100% premium would charge the LP as much as the maximum payout.");
  // Aim for ten positions and at most half the modeled fee ceiling per position.
  const cap = Math.floor(Math.min(capital / 10, baseline.recommendedCap / 2) * 1e6) / 1e6;
  if (cap < .000001) return blocked("Capital or modeled fees are too small for a supported quote.");
  const guide = bidGuidance(history, principal, cap, terms.days, activity, includeTest)!;
  if (guide.suggestedPct === null) return blocked("No supported quote: modeled claims exceed the LP premium budget. Use manual terms only after reviewing the risk.");
  return { ...terms, cap: cap.toFixed(6).replace(/\.?0+$/, ""), spots: String(maximumSpots(String(capital), String(cap))),
    rate: guide.suggestedPct.toFixed(2), feeScale: guide.feeScale, quoteIssue: undefined };
}
