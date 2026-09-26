import { expect, test } from "bun:test";
import { moveRangeBound, rangeSliderDomain, rangeTickPrice } from "../../frontend/src/lib/range-slider";
import { priceToRawTick } from "../../frontend/src/lib/nacre-liquidity";

test("million-dollar pool bounds do not flatten the useful price range", () => {
  const d = rangeSliderDomain(.01, 999201.68, 2689.49, 2420.54, 2958.44);
  expect(rangeTickPrice(d.start)).toBeGreaterThan(2000);
  expect(rangeTickPrice(d.end)).toBeLessThan(3500);
  const spot = (priceToRawTick(2689.49) - d.start) / (d.end - d.start);
  expect(spot).toBeCloseTo(.5);
});
test("dragging across the other bound preserves one real bin", () => {
  const d = rangeSliderDomain(.01, 999201.68, 2689.49, 2420.54, 2958.44);
  const upper = priceToRawTick(2958.44);
  const lower = moveRangeBound("lower", d.end, upper, d.minTick, d.maxTick);
  expect(upper - lower).toBe(10);
  expect(priceToRawTick(rangeTickPrice(lower))).toBe(lower);
  expect(moveRangeBound("upper", d.start, lower, d.minTick, d.maxTick) - lower).toBe(10);
});
test("view follows price changes and respects restricted pool limits", () => {
  const before = rangeSliderDomain(.01, 999201.68, 2689.49, 2420, 2958);
  const after = rangeSliderDomain(.01, 999201.68, 3200, 2420, 2958);
  expect(after.end).toBeGreaterThan(before.end);
  const narrow = rangeSliderDomain(2400, 3000, 3500, 2450, 2950);
  expect(narrow.end).toBe(narrow.maxTick);
  expect(narrow.start).toBeGreaterThanOrEqual(narrow.minTick);
  expect(narrow.end).toBeGreaterThan(narrow.start);
});
