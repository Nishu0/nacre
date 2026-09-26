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

test("new funded envelopes accept narrower tick-aligned positions only inside both bounds", () => {
  const flexible = { ...offer, supportsSubranges: true };
  expect(bidMatchesPosition(flexible, { ...offer, tickLower: -199000, tickUpper: -191000 })).toBe(true);
  expect(bidMatchesPosition(flexible, offer)).toBe(true);
  for (const position of [
    { ...offer, tickLower: -200010 }, { ...offer, tickUpper: -189990 },
    { ...offer, tickLower: -190000 }, { ...offer, tickLower: -199999 },
    { ...offer, poolId: "other" }, { ...offer, tickUpper: NaN },
  ]) expect(bidMatchesPosition(flexible, position)).toBe(false);
});

test("narrow positions must contain the current pool price and use an available spot", async () => {
  const { bidCanProtectPosition } = await import("../frontend/src/lib/funded-bids");
  const flexible = { ...offer, supportsSubranges: true, availableSpots: 1 };
  const position = { ...offer, tickLower: -196000, tickUpper: -194000 };
  expect(bidCanProtectPosition(flexible, position, -195000, "0xbuyer")).toBe(true);
  expect(bidCanProtectPosition(flexible, position, -196000, "0xbuyer")).toBe(true);
  expect(bidCanProtectPosition(flexible, position, -194000, "0xbuyer")).toBe(false);
  expect(bidCanProtectPosition({ ...flexible, availableSpots: 0 }, position, -195000, "0xbuyer")).toBe(false);
  expect(bidCanProtectPosition(flexible, position, -195000, "0xmaker")).toBe(false);
  expect(bidCanProtectPosition({ ...flexible, unreservedCapital: "0" }, position, -195000)).toBe(false);
  // Overlapping makers cannot be combined to cover a position neither accepts.
  const wide = { ...offer, tickLower: -201000, tickUpper: -189000 };
  expect([flexible, { ...flexible, tickLower: -202000, tickUpper: -195000 }].some((bid) => bidMatchesPosition(bid, wide))).toBe(false);
});
