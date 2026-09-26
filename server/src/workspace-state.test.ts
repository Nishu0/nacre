import { expect, test } from "bun:test";
import { openDb } from "./db";
import { activeCoverage } from "./workspace-state";
import type { CoverageSnapshot } from "../../frontend/src/lib/coverage-contracts";

test("reset hides old chain records and retains new bids, positions and policies", () => {
  const db = openDb(":memory:");
  for (const [kind, id] of [["offer", "0xabc"], ["position", "1"], ["request", "1"]]) {
    db.prepare("INSERT INTO workspace_archives VALUES (?, ?, ?)").run(kind, id, "2026-09-27");
  }
  const snapshot = {
    configured: true, blockNumber: "100", currentTick: 0, poolTicks: {}, reserved: "12",
    offers: ["0xABC", "0xdef"].map((address) => ({ address: address as `0x${string}`, poolId: "pool", owner: "maker", tickLower: 0, tickUpper: 10, duration: 86400, premiumBps: 800, deposited: "10", withdrawn: "0", available: "10", closed: false })),
    positions: ["1", "2"].map((tokenId) => ({ tokenId, poolId: "pool", owner: "buyer", tickLower: 0, tickUpper: 10 })),
    requests: ["1", "2"].map((id) => ({ id, tokenId: id, poolId: "pool", lp: "buyer", underwriter: "maker", feeFloor: id === "1" ? "10" : "2", payoutCap: id === "1" ? "10" : "2", premium: "1", quoteDeadline: 100, startAt: 0, endAt: 86400, duration: 86400, status: 2, tickLower: 0, tickUpper: 10 })),
  } as CoverageSnapshot;
  const result = activeCoverage(db, snapshot);
  expect(result.offers.map((row) => row.address)).toEqual(["0xdef"]);
  expect(result.positions.map((row) => row.tokenId)).toEqual(["2"]);
  expect(result.requests.map((row) => row.id)).toEqual(["2"]);
  expect(result.reserved).toBe("2");
  expect(snapshot.reserved).toBe("12");
  db.close();
});
