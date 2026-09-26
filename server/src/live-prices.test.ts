import { expect, test } from "bun:test";
import { parseChainlinkRound, parsePythPrice } from "./live-prices";

const feedId = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const now = Date.now();
const recent = Math.floor(now / 1000) - 5;

test("Pyth prices use exponent, confidence, and publish-time validation", () => {
  const feed = { id: feedId, price: {
    price: "268783439454", expo: -8, conf: "41560546", publish_time: recent,
  } };
  expect(parsePythPrice(feed, feedId, now).usd).toBeCloseTo(2687.83439454);
  expect(parsePythPrice(feed, feedId, now).confidenceUsd).toBeCloseTo(.41560546);
  expect(() => parsePythPrice({ ...feed, id: "wrong" }, feedId, now)).toThrow("ID mismatch");
  expect(() => parsePythPrice({ ...feed, price: { ...feed.price,
    publish_time: recent - 100 } }, feedId, now)).toThrow("stale");
  expect(() => parsePythPrice({ ...feed, price: { ...feed.price,
    conf: "999999999999" } }, feedId, now)).toThrow("Invalid Pyth quote");
});

test("Chainlink rounds reject stale and negative answers", () => {
  const word = (value: bigint) => BigInt.asUintN(256, value).toString(16).padStart(64, "0");
  const round = (answer: bigint, time = recent) => "0x" + [
    7n, answer, BigInt(time), BigInt(time), 7n,
  ].map(word).join("");
  expect(parseChainlinkRound(round(268783439454n), 8, 60, now).usd)
    .toBeCloseTo(2687.83439454);
  expect(() => parseChainlinkRound(round(-1n), 8, 60, now)).toThrow("Invalid Chainlink answer");
  expect(() => parseChainlinkRound(round(100000000n, recent - 100), 8, 60, now)).toThrow("stale");
});
