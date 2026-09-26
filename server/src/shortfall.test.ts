import { expect, test } from "bun:test";
import { shortfallTotal } from "../../frontend/src/lib/shortfall";
import type { CoverageSnapshot, CoverageRequest } from "../../frontend/src/lib/coverage-contracts";
import { settlementBlock } from "./settlement-block";

function snapshot(requests: Partial<CoverageRequest>[]): CoverageSnapshot {
  return { configured: true, blockNumber: "100", currentTick: 0, poolTicks: {}, positions: [], reserved: "0",
    offers: [{ owner: "0xABC", address: "0xdef", poolId: "pool", tickLower: 0, tickUpper: 10,
      duration: 2592000, premiumBps: 1800, deposited: "100000000", withdrawn: "0", available: "91800000", closed: false }], requests: requests.map((request) => ({
    poolId: "pool", id: "1", tokenId: "1", feeFloor: "10000000", quoteDeadline: 0,
    startAt: 0, endAt: 2592000, duration: 2592000, status: 2, tickLower: 0, tickUpper: 10,
    lp: "0x123", underwriter: "0xdef", payoutCap: "10000000", premium: "1800000", ...request,
  })) };
}
test("active policies show zero shortfall, regardless of premium and cap", () => {
  const data = snapshot([{ status: 2 }]);
  expect(shortfallTotal(data, "0x123", "lp")).toBe(0n);
  expect(shortfallTotal(data, "0xabc", "underwriter")).toBe(0n);
});
test("both wallets count only their confirmed settlement payouts", () => {
  const settlement = { payout: "1400000", eligibleFees: "8600000", transactionHash: "0xabc" as const, blockNumber: "99" };
  const data = snapshot([{ status: 3, settlement }, { status: 2 },
    { status: 3, lp: "0x999", underwriter: "0xother", settlement: { ...settlement, payout: "9000000" } }]);
  expect(shortfallTotal(data, "0x123", "lp")).toBe(1400000n);
  expect(shortfallTotal(data, "0xabc", "underwriter")).toBe(1400000n);
});
test("missing settled receipt is unknown; a verified zero is zero", () => {
  expect(shortfallTotal(snapshot([{ status: 3 }]), "0x123", "lp")).toBeNull();
  expect(shortfallTotal(snapshot([{ status: 3, settlement: { payout: "0", eligibleFees: "12000000", transactionHash: "0xabc", blockNumber: "99" } }]), "0x123", "lp")).toBe(0n);
});
test("settlement lookup finds exact transition with bounded reads", async () => {
  for (const target of [0n, 1n, 47300000n, 49999999n, 50000000n]) {
    let reads = 0;
    expect(await settlementBlock(50000000n, async (block) => { reads++; return block >= target; })).toBe(target);
    expect(reads).toBeLessThan(60);
  }
  await expect(settlementBlock(100n, async () => false)).rejects.toThrow("not settled");
});
