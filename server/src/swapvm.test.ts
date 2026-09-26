import { expect, test } from "bun:test";
import { swapInputLimit } from "../../frontend/src/lib/swapvm";
import { atomicCheckoutAbi, atomicPurchase } from "../../frontend/src/lib/atomic-checkout";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
test("exact output swap input limit rounds upward without floating point", () => {
  expect(swapInputLimit(1n)).toBe(2n);
  expect(swapInputLimit(2700_000000n)).toBe(2713_500000n);
  expect(() => swapInputLimit(0n)).toThrow();
});
test("single token purchase attribution requires the configured checkout emitter", () => {
  const checkout = "0x1111111111111111111111111111111111111111";
  const buyer = "0x2222222222222222222222222222222222222222";
  const account = "0x3333333333333333333333333333333333333333";
  const offer = "0x4444444444444444444444444444444444444444";
  const log = { address: checkout, topics: encodeEventTopics({ abi: atomicCheckoutAbi, eventName: "SuppliedAndProtected", args: { buyer, account, tokenId: 1n } }) as Hex[], data: encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [2n, offer, 80000n]) };
  expect(atomicPurchase([log], buyer, checkout)?.account).toBe(account);
  expect(atomicPurchase([log], buyer)).toBeNull();
  expect(atomicPurchase([log], offer, checkout)).toBeNull();
});
