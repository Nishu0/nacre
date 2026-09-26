import { expect, test } from "bun:test";
import { readAtMintBlock } from "./position-registration";

test("registration uses the receipt block through a lagging RPC retry", async () => {
  const reads: bigint[] = [];
  const waits: number[] = [];
  const result = await readAtMintBlock(47333535n, async (block) => {
    reads.push(block);
    if (reads.length === 1) throw new Error("execution reverted: NOT_MINTED");
    if (reads.length === 2) throw new Error("header not found");
    return { tokenId: "28545", owner: "recipient" };
  }, async (ms) => { waits.push(ms); });
  expect(reads).toEqual([47333535n, 47333535n, 47333535n]);
  expect(waits).toEqual([300, 800]);
  expect(result.tokenId).toBe("28545");
});

test("persistent missing position gives a save retry instruction instead of minting again", async () => {
  let attempts = 0;
  await expect(readAtMintBlock(50n, async () => {
    attempts++;
    throw new Error("NOT_MINTED");
  }, async () => {})).rejects.toThrow("do not mint again");
  expect(attempts).toBe(4);
});

test("unrelated execution failures are not mistaken for indexing delays", async () => {
  let attempts = 0;
  await expect(readAtMintBlock(50n, async () => {
    attempts++;
    throw new Error("Invalid pool key");
  }, async () => {})).rejects.toThrow("Invalid pool key");
  expect(attempts).toBe(1);
});
