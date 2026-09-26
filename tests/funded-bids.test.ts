import { expect, test } from "bun:test";
import { availableBid, bidMatchesPosition } from "../frontend/src/lib/funded-bids";
import type { CoverageOffer } from "../frontend/src/lib/coverage-contracts";
const offer: CoverageOffer = { poolId: "0xpool", address: "0x123", owner: "0xmaker", tickLower: -200000,
  tickUpper: -190000, duration: 2592000, premiumBps: 800, deposited: "100000000", withdrawn: "0", available: "10000000", closed: false };
test("investors can use only funded non-self bids in range with sufficient cap", () => {
  expect(availableBid(offer, -195000, "0xbuyer", 10000000n)).toBe(true);
  expect(availableBid(offer, -195000, "0xMAKER")).toBe(false);
  expect(availableBid({ ...offer, closed: true }, -195000)).toBe(false);
  expect(availableBid({ ...offer, available: "0" }, -195000)).toBe(false);
  expect(availableBid(offer, -195000, "0xbuyer", 10000001n)).toBe(false);
  expect(availableBid(offer, -200001)).toBe(false);
  expect(availableBid(offer, -190000)).toBe(false);
  expect(availableBid(offer, -200000)).toBe(true);
  expect(availableBid(offer, -195000, "0xbuyer", 0n)).toBe(false);
});
test("coverage uses exactly the selected bid's pool and ticks", () => {
  expect(bidMatchesPosition(offer, offer)).toBe(true);
  expect(bidMatchesPosition(offer, { ...offer, tickLower: offer.tickLower + 10 })).toBe(false);
  expect(bidMatchesPosition(offer, { ...offer, poolId: "different" })).toBe(false);
});
