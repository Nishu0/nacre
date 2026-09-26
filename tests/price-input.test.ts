import { expect, test } from "bun:test";
import { priceInputToTick, priceToRawTick } from "../frontend/src/lib/nacre-chain";

test("empty and edited price fields stay invalid without crashing the form", () => {
  for (const value of ["", " ", "0", "-1", "-", ".", "1e", "NaN", "Infinity", "1e999", "1e-999"]) {
    expect(Number.isNaN(priceInputToTick(value))).toBe(true);
  }
  expect(priceInputToTick("2688.90")).toBe(priceToRawTick(2688.90));
  expect(Number.isNaN(priceInputToTick(""))).toBe(true);
  expect(priceInputToTick("2400")).toBe(priceToRawTick(2400));
  expect(() => priceToRawTick(0)).toThrow("Invalid position bound.");
});
