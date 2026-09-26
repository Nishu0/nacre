import { expect, test } from "bun:test";
import { readConfirmedBalance } from "../frontend/src/lib/confirmed-balance";

test("a lagging replica retries the confirmed block without falling back to stale latest", async () => {
  const blocks: bigint[] = [];
  const result = await readConfirmedBalance(47335706n, async (block) => {
    blocks.push(block);
    if (blocks.length < 3) throw new Error("block not found: 0x2d2491a");
    return 10n ** 18n;
  }, async () => {});
  expect(result).toBe(10n ** 18n);
  expect(blocks).toEqual([47335706n, 47335706n, 47335706n]);
});

test("persistent indexing failure stops after bounded retries", async () => {
  let reads = 0;
  await expect(readConfirmedBalance(1n, async () => {
    reads++;
    throw new Error("header not found");
  }, async () => {})).rejects.toThrow("header not found");
  expect(reads).toBe(5);
});

test("contract failures are not mistaken for an indexing delay", async () => {
  let pauses = 0;
  await expect(readConfirmedBalance(1n, async () => {
    throw new Error("execution reverted");
  }, async () => { pauses++; })).rejects.toThrow("execution reverted");
  expect(pauses).toBe(0);
});
