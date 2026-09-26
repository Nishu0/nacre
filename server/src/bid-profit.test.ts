import { expect, test } from "bun:test";
import { bidProfitScenarios } from "../../frontend/src/lib/bid-profit";
const input = { capital: 100, days: 30, premiumPct: 8, principal: 1000, cap: 10 };
const history = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), apyBasePct: 7.3 }));
test("profits subtract full shortfalls from premiums and exclude idle capital from claims", () => {
  const result = bidProfitScenarios(history, input)!;
  expect(result.count).toBe(10);
  expect(result.best.profit).toBe(8);
  expect(result.worst.profit).toBe(-92);
  expect(result.worst.ending).toBe(8);
  expect(result.median!.claims).toBeCloseTo(40);
  expect(result.median!.profit).toBeCloseTo(-32);
  expect(result.windows).toBe(31);
  const idle = bidProfitScenarios(history, { ...input, capital: 105 })!;
  expect(idle.idle).toBe(5);
  expect(idle.worst.ending).toBe(13);
});
test("duration and terms recalculate median while missing history stays unavailable", () => {
  expect(bidProfitScenarios(history, { ...input, days: 7 })!.median!.profit).toBeCloseTo(-78);
  expect(bidProfitScenarios(history, { ...input, premiumPct: 10 })!.best.profit).toBe(10);
  expect(bidProfitScenarios([], input)!.median).toBeNull();
  expect(bidProfitScenarios(history, { ...input, capital: 0 })).toBeNull();
  expect(bidProfitScenarios(history, { ...input, cap: NaN })).toBeNull();
});
test("handles decimal capacity and uses contract premium rounding", () => {
  expect(bidProfitScenarios(history, { ...input, capital: .3, cap: .1 })!.count).toBe(3);
  expect(bidProfitScenarios(history, { ...input, capital: .000003, cap: .000001, premiumPct: .01 })!.premiums).toBe(.000003);
});
test("median averages the two middle payout windows and skips nonconsecutive data", () => {
  const varied = [{ date: "2026-01-01", apyBasePct: 36.5 }, { date: "2026-01-02", apyBasePct: 109.5 }];
  const result = bidProfitScenarios(varied, { ...input, days: 1 })!;
  expect(result.median!.claims).toBeCloseTo(80);
  expect(bidProfitScenarios(history.filter((_, i) => i !== 30), input)!.windows).toBe(1);
});
