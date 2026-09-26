import type { YieldDay } from "./underwriting-simulator";
export type BidFundingTerms = { capital: string; days: number; rate: string; cap?: string; spots?: string; principal?: string; autoRate?: boolean; quoteIssue?: string; feeScale?: number };
export function bidProfitScenarios(history: YieldDay[], input: {
  capital: number; days: number; premiumPct: number; principal: number; cap: number; spots?: number; feeScale?: number;
}) {
  const { capital, days, premiumPct, principal, cap } = input;
  if (input.feeScale !== undefined && (input.feeScale < 0 || input.feeScale > 1)) return null;
  if (input.spots !== undefined && (!Number.isInteger(input.spots) || input.spots < 1 || input.spots > 100)) return null;
  if (Object.values(input).some((value) => !Number.isFinite(value)) || capital <= 0 || principal <= 0 || cap <= 0
    || Math.round(premiumPct * 100) < 1 || premiumPct > 100 || !Number.isInteger(days) || days < 1 || days > 90) return null;
  const capitalUnits = Math.round(capital * 1e6), capUnits = Math.round(cap * 1e6);
  if (!Number.isSafeInteger(capitalUnits) || !Number.isSafeInteger(capUnits) || capUnits < 1) return null;
  const count = Math.min(Number(BigInt(capitalUnits) / BigInt(capUnits)), input.spots ?? 100);
  const reserved = count * cap;
  const premiums = count * Number((BigInt(capUnits) * BigInt(Math.round(premiumPct * 100)) + 9999n) / 10000n) / 1e6;
  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const fees: number[] = [];
  for (let start = 0; start + days <= sorted.length; start++) {
    const rows = sorted.slice(start, start + days);
    if (rows.some((row, i) => !Number.isFinite(row.apyBasePct) || row.apyBasePct < 0 || !Number.isFinite(Date.parse(row.date))
      || (i > 0 && Date.parse(row.date) - Date.parse(rows[i - 1].date) !== 86_400_000))) continue;
    fees.push(rows.reduce((sum, row) => sum + principal * row.apyBasePct / 100 / 365, 0));
  }
  const payouts = fees.map((fee) => count * Math.min(cap, Math.max(0, cap - fee * (input.feeScale ?? 1)))).sort((a, b) => a - b);
  const middle = Math.floor(payouts.length / 2);
  const medianPayout = payouts.length ? (payouts.length % 2 ? payouts[middle] : (payouts[middle - 1] + payouts[middle]) / 2) : null;
  const scenario = (claims: number) => ({ claims, profit: premiums - claims, ending: capital + premiums - claims,
    returnPct: (premiums - claims) / capital * 100 });
  return { count, reserved, idle: capital - reserved, premiums, windows: payouts.length, latestDate: sorted.at(-1)?.date,
    best: scenario(0), median: medianPayout === null ? null : scenario(medianPayout), worst: scenario(reserved) };
}
