import { expect, test } from "bun:test";
import { clearPendingCheckout, readPendingCheckout, savePendingCheckout } from "../../frontend/src/lib/pending-checkout";
import type { SupplyReview } from "../../frontend/src/lib/supply-review";

test("pending checkout survives reload, stays scoped to its wallet and pool, and clears after confirmation", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    setItem: (key: string, value: string) => entries.set(key, value),
    getItem: (key: string) => entries.get(key) ?? null,
    removeItem: (key: string) => entries.delete(key),
  } });
  try {
    const review: SupplyReview = {
      account: `0x${"11".repeat(20)}`, poolId: `0x${"22".repeat(32)}`, marketId: "market",
      token: `0x${"33".repeat(20)}`, offer: `0x${"44".repeat(20)}`, symbol: "nWETH",
      fee: 10000, lower: 2400, upper: 2900, wethAmount: 0.18, usdcAmount: 500,
      total: 1000, feeCap: "10000000", premiumUnits: "434000", offerIndex: 0,
    };
    const hash = `0x${"55".repeat(32)}` as const;
    savePendingCheckout(hash, review);
    expect(readPendingCheckout(review.account, review.poolId)).toEqual({ hash, review });
    expect(readPendingCheckout(`0x${"66".repeat(20)}`, review.poolId)).toBeNull();
    expect(readPendingCheckout(review.account, `0x${"77".repeat(32)}`)).toBeNull();
    clearPendingCheckout(review);
    expect(readPendingCheckout(review.account, review.poolId)).toBeNull();
    savePendingCheckout(hash, review);
    for (const key of entries.keys()) entries.set(key, "corrupt storage");
    expect(readPendingCheckout(review.account, review.poolId)).toBeNull();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
