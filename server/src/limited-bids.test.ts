import { describe, expect, test } from "bun:test";
import { maximumSpots, bidGuidance, automaticBidTerms } from "../../frontend/src/lib/bid-guidance";
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
  expect(exclude.suggestedPct).toBeNull();
  expect(exclude.requiredPct).toBeCloseTo(121);
  expect(include.requiredPct).toBeLessThan(exclude.requiredPct);
  expect(exclude.affordablePct).toBe(0);
 });
 test("zero measured fee scale makes median claims match the worst case", () => {
  const result = bidProfitScenarios(history, { capital: 100, cap: 10, principal: 1000, days: 30, premiumPct: 8, spots: 10, feeScale: 0 })!;
  expect(result.median?.profit).toBe(result.worst.profit);
 });
 test("competing price boundaries retain their exact bins", () => {
  for (const tick of [-198410, -196400, -204280, -193300]) expect(priceToRawTick(Number(String(1.0001 ** tick * 1e12)))).toBe(tick);
 });
});

const terms = { capital: "100", principal: "1000", cap: "10", spots: "10", days: 30, rate: "100", autoRate: true };
const activity = { price: 2689, tvl: 1000, feePct: 1, swaps: 30, syntheticSwaps: 0, grossFees: 1, syntheticFees: 0,
 baseApr: 6, organicApr: 6, hours: 24, low: 2680, high: 2690, capturedAt: "", methodology: "" };
describe("automatic underwriting terms", () => {
 test("derives affordable terms and fully backed integer spots from capital", () => {
  const small = automaticBidTerms(history, { ...terms, capital: "10" }, activity, 2600, 2800);
  const large = automaticBidTerms(history, terms, activity, 2600, 2800);
  expect(small.quoteIssue).toBeUndefined(); expect(large.quoteIssue).toBeUndefined();
  expect(small.cap).toBe("1"); expect(small.spots).toBe("10");
  expect(Number(large.cap)).toBeCloseTo(2.465753);
  expect(large.spots).toBe("40"); expect(Number(large.rate)).toBeLessThan(100);
  expect(Number(large.cap) * Number(large.spots)).toBeLessThanOrEqual(100);
  expect(automaticBidTerms(history, { ...terms, capital: "10000" }, activity, 2600, 2800).spots).toBe("100");
 });
 test("zero organic earnings never become a 100 percent recommendation", () => {
  const zero = { ...activity, organicApr: 0, syntheticSwaps: 30 };
  const result = automaticBidTerms(history, terms, zero, 2600, 2800);
  expect(result.quoteIssue).toContain("zero"); expect(result.rate).toBe(""); expect(result.spots).toBe("0");
  expect(automaticBidTerms(history, terms, zero, 2600, 2800, true).quoteIssue).toBeUndefined();
 });
 test("missing observations, invalid capital, failed refresh and out of range block automatic funding", () => {
  for (const capital of ["", "0", "-1", "NaN", "Infinity", "1000000000000"])
   expect(automaticBidTerms(history, { ...terms, capital }, activity, 2600, 2800).quoteIssue).toBeTruthy();
  expect(automaticBidTerms([], terms, activity, 2600, 2800).quoteIssue).toBeTruthy();
  expect(automaticBidTerms(history, terms, null, 2600, 2800).quoteIssue).toBeTruthy();
  expect(automaticBidTerms(history, terms, { ...activity, swaps: 2 }, 2600, 2800).quoteIssue).toBeTruthy();
  expect(automaticBidTerms(history, terms, activity, 2700, 2800).quoteIssue).toBeTruthy();
  expect(automaticBidTerms(history, terms, activity, 2800, 2600).quoteIssue).toBeTruthy();
  expect(automaticBidTerms(history, terms, activity, 2600, 2800, false, "RPC failed").quoteIssue).toBeTruthy();
 });
});
