import { describe, expect, test } from "bun:test";
import { maximumSpots, bidGuidance } from "../../frontend/src/lib/bid-guidance";
import { bidProfitScenarios } from "../../frontend/src/lib/bid-profit";
import { priceToRawTick } from "../../frontend/src/lib/nacre-liquidity";
const history = Array.from({ length: 60 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), apyBasePct: 6 }));
describe("limited bids", () => {
 test("capital fully backs spots; selected slots bound profits", () => {
  expect(maximumSpots("100", "10")).toBe(10);
  const input = { capital: 100, cap: 10, principal: 1000, days: 30, premiumPct: 8, spots: 3 };
  const result = bidProfitScenarios(history, input)!;
  expect(result.count).toBe(3); expect(result.best.profit).toBe(2.4); expect(result.worst.profit).toBe(-27.6);
  expect(result.idle).toBe(70);
  for (const spots of [-1, 1.5, 101]) expect(bidProfitScenarios(history, { ...input, spots })).toBeNull();
 });
 test("six percent annual rate is not a thirty day return", () => {
  const guide = bidGuidance(history, 1000, 10, 30)!;
  expect(guide.budget).toBeCloseTo(4.9315068);
  expect(guide.affordablePct).toBeCloseTo(9.8630137);
  expect(guide.feasible).toBe(false);
 });
 test("lower observed earnings increase suggested premium, synthetic needs opt in", () => {
  const activity = { price: 2689, tvl: 1000, feePct: 1, swaps: 10, syntheticSwaps: 10, grossFees: 1, syntheticFees: 1, baseApr: 6, organicApr: 0, hours: 24, low: 2680, high: 2690, capturedAt: "", methodology: "" };
  const exclude = bidGuidance(history, 1000, 10, 30, activity)!;
  const include = bidGuidance(history, 1000, 10, 30, activity, true)!;
  expect(exclude.suggestedPct).toBeGreaterThan(include.suggestedPct);
  expect(exclude.affordablePct).toBe(0);
 });
 test("competing price boundaries retain their exact bins", () => {
  for (const tick of [-198410, -196400, -204280, -193300]) expect(priceToRawTick(Number(String(1.0001 ** tick * 1e12)))).toBe(tick);
 });
});
