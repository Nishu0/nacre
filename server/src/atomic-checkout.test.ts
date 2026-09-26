import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from "viem";
import { atomicPurchase, atomicCheckoutAbi } from "../../frontend/src/lib/atomic-checkout";
const checkout = "0x1111111111111111111111111111111111111111" as Address;
const buyer = "0x2222222222222222222222222222222222222222" as Address;
const account = "0x3333333333333333333333333333333333333333" as Address;
const offer = "0x4444444444444444444444444444444444444444" as Address;
const log = { address: checkout,
 topics: encodeEventTopics({ abi: atomicCheckoutAbi, eventName: "SuppliedAndProtected", args: { buyer, account, tokenId: 42n } }) as Hex[],
 data: encodeAbiParameters([{ type: "uint256" }, { type: "address" }, { type: "uint256" }], [3n, offer, 434000n]),
};
test("atomic receipt attributes the escrowed position only to its verified buyer", () => {
 const purchase = atomicPurchase([log], buyer, checkout)!;
 expect(purchase.account).toBe(account); expect(purchase.tokenId).toBe(42n);
 expect(purchase.requestId).toBe(3n); expect(purchase.premium).toBe(434000n);
 expect(atomicPurchase([log], account, checkout)).toBeNull();
 expect(atomicPurchase([{ ...log, address: offer }], buyer, checkout)).toBeNull();
 expect(atomicPurchase([{ ...log, data: "0x" }], buyer, checkout)).toBeNull();
 expect(atomicPurchase([], buyer, checkout)).toBeNull();
});
