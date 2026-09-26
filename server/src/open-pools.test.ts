import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, parseAbiParameters, type TransactionReceipt } from "viem";
import { openPoolAbi, openPoolKey, openPoolId, openPoolDeploymentData, startingSqrtPrice, poolInitializeAbi, OPEN_POOL_MANAGER } from "../../frontend/src/lib/open-pool";
import { TEST_WETH_POOL } from "../../frontend/src/lib/test-pools";
import { verifyOpenPool, saveVerifiedOpenPool } from "./open-pools";
import { registeredPool } from "./pool-registry";
import { openDb } from "./db";

const creator = "0x0000000000000000000000000000000000000123" as const;
const address = "0x0000000000000000000000000000000000000456" as const;
const factory = "0x0000000000000000000000000000000000000789" as const;
const hash = `0x${"12".repeat(32)}` as const;
function fixture() {
  const fee = 3000, sqrtPriceX96 = startingSqrtPrice("2700"), poolId = openPoolId(fee), key = openPoolKey(fee);
  const tick = Math.floor(Math.log(2700e-12) / Math.log(1.0001));
  const logs = [
    { address, topics: encodeEventTopics({ abi: openPoolAbi, eventName: "PoolCreated", args: { poolId, creator } }),
      data: encodeAbiParameters(parseAbiParameters("address,uint24,uint160,int24"), [factory, fee, sqrtPriceX96, tick]) },
    { address: OPEN_POOL_MANAGER, topics: encodeEventTopics({ abi: poolInitializeAbi, eventName: "Initialize", args: { id: poolId, currency0: key.currency0, currency1: key.currency1 } }),
      data: encodeAbiParameters(parseAbiParameters("uint24,int24,address,uint160,int24"), [fee, 10, key.hooks, sqrtPriceX96, tick]) },
  ];
  return { receipt: { status: "success", contractAddress: address, transactionHash: hash, logs } as unknown as TransactionReceipt,
    transaction: { input: openPoolDeploymentData(fee, sqrtPriceX96), from: creator } };
}
test("starting price respects 18/6 decimals and pool keys distinguish trading fees", () => {
  const sqrt = startingSqrtPrice("2700");
  expect((Number(sqrt) / 2 ** 96) ** 2 * 1e12).toBeCloseTo(2700, 8);
  expect(openPoolId(500)).toBe(TEST_WETH_POOL);
  expect(openPoolId(3000)).not.toBe(TEST_WETH_POOL);
  for (const price of ["", "0", "NaN", "-1", "1000001"]) expect(() => startingSqrtPrice(price)).toThrow();
});
test("registration accepts supported deployment and rejects spoofed or failed transactions", () => {
  const { receipt, transaction } = fixture();
  expect(verifyOpenPool(receipt, transaction).offerFactory).toBe(factory);
  expect(() => verifyOpenPool({ ...receipt, status: "reverted" }, transaction)).toThrow();
  expect(() => verifyOpenPool(receipt, { ...transaction, input: "0x1234" })).toThrow();
  expect(() => verifyOpenPool(receipt, { ...transaction, from: factory })).toThrow();
  expect(() => verifyOpenPool({ ...receipt, logs: receipt.logs.slice(0, 1) }, transaction)).toThrow();
  expect(() => verifyOpenPool({ ...receipt, logs: receipt.logs.map((log) => ({ ...log, address: creator })) }, transaction)).toThrow();
});
test("confirmed pools persist their factory and trading fee, and retry is idempotent", () => {
  const db = openDb(":memory:");
  try {
    const { receipt, transaction } = fixture();
    const market = saveVerifiedOpenPool(db, hash, receipt, transaction);
    expect(market.feeTier).toBe("0.3%");
    expect(market.deployment?.poolId).toBe(openPoolId(3000));
    expect(registeredPool(db, openPoolId(3000))?.factory).toBe(factory);
    expect(saveVerifiedOpenPool(db, hash, receipt, transaction).id).toBe(market.id);
    expect(db.query("SELECT COUNT(*) AS n FROM open_pool_configs").get()).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM market_pledges").get()).toEqual({ n: 0 });
  } finally { db.close(); }
});
