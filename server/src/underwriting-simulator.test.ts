import { describe, expect, test } from "bun:test";
import { simulateUnderwriting, type SimulationInput } from "../../frontend/src/lib/underwriting-simulator";
import { backtest } from "./backtest";
const history = Array.from({ length: 180 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10), apyBasePct: 10,
}));
const inputs: SimulationInput = { principal: 1000, capital: 100, cap: 5, days: 30,
  premiumPct: 10, lossBudget: 20, positionLimit: 100, lpFeeBudgetPct: 10,
  spot: 2500, lower: 2250, upper: 2750, shockPct: 0, stressWeightPct: 25 };
describe("underwriting economic scenarios", () => {
  test("reserves full caps and keeps correlated zero-fee claims inside the loss budget", () => {
    const r = simulateUnderwriting(history, inputs);
    expect(r.count).toBe(4);
    expect(r.reserved).toBe(20);
    expect(r.worstLoss).toBe(18);
    expect(r.scenarios[2].underwriterNet).toBe(-18);
    expect(r.scenarios[2].lpNet).toBe(4.5);
    expect(r.reserved + r.idle).toBe(inputs.capital);
  });
  test("never reuses collateral or exceeds the explicit position limit", () => {
    const r = simulateUnderwriting(history, { ...inputs, capital: 12, lossBudget: 100 });
    expect(r.count).toBe(2);
    expect(simulateUnderwriting(history, { ...inputs, positionLimit: 1 }).count).toBe(1);
    expect(simulateUnderwriting(history, { ...inputs, lossBudget: 0 }).count).toBe(0);
  });
  test("narrower bins increase payouts in the same assumed falling price scenario", () => {
    const wide = simulateUnderwriting(history, { ...inputs, shockPct: -30 });
    const narrow = simulateUnderwriting(history, { ...inputs, lower: 2475, shockPct: -30 });
    expect(narrow.inRangeDays).toBeLessThan(wide.inRangeDays);
    expect(narrow.expectedPayout).toBeGreaterThan(wide.expectedPayout);
    expect(narrow.feasible).toBe(false);
  });
  test("duration recomputes all contiguous windows across the full six months", () => {
    expect(simulateUnderwriting(history, inputs).windowCount).toBe(151);
    const r = simulateUnderwriting(history, { ...inputs, days: 90 });
    expect(r.windowCount).toBe(91);
    expect(r.recent).toBeCloseTo(1000 * .1 * 90 / 365);
    const gap = history.filter((_, i) => i !== 80);
    expect(simulateUnderwriting(gap, inputs).windowCount).toBe(121);
  });
  test("flags outside range, oversized caps and impossible premium intervals", () => {
    expect(simulateUnderwriting(history, { ...inputs, lower: 2510 }).feasible).toBe(false);
    expect(simulateUnderwriting(history, { ...inputs, cap: 100 }).capWithinLimits).toBe(false);
    const r = simulateUnderwriting(history, { ...inputs, lpFeeBudgetPct: 0 });
    expect(r.feasible).toBe(false);
    expect(r.premiumAcceptable).toBe(false);
  });
  test("rejects invalid inputs rather than displaying profitable NaN results", () => {
    for (const patch of [{ cap: 0 }, { upper: 2000 }, { principal: NaN }, { days: 1.5 }, { premiumPct: 101 }]) {
      expect(() => simulateUnderwriting(history, { ...inputs, ...patch })).toThrow();
    }
  });
  test("API keeps 180 yield days while showing 90 daily chart points", () => {
    const r = backtest(history.map((row) => ({ ...row, tvlUsd: 1000000, volumeUsd: 200000, grossPoolFeesUsd: 100 })), 1000);
    expect(r.yieldHistory).toHaveLength(180);
    expect(r.daily).toHaveLength(90);
  });
});
