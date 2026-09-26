// Both pool generations remain supported. Never replace an existing NFT's assets.
export const NACRE_TEST_WETH = "0x3333C20E21Eeaed85766232B20641d56fd3788c4" as const;
export const TEST_WETH_POOL = "0x743bf18c39cc3c9a033ca8dd020a49609e82c25243bc005f5bb5520e4a5748ae" as const;
export const TEST_WETH_LAUNCHER = "0x55AB9D22a516DD6D03571A68398b38eD9c867821" as const;
export const TEST_WETH_FACTORY = "0x815bAcd48995FC5AbE143bC08aFcB40c7306f3B7" as const;
export const LEGACY_WETH_POOL = "0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56" as const;
export const TEST_POOLS = [
  { poolId: TEST_WETH_POOL, weth: NACRE_TEST_WETH, symbol: "nWETH", factory: TEST_WETH_FACTORY, launcher: TEST_WETH_LAUNCHER },
  { poolId: LEGACY_WETH_POOL, weth: "0x4200000000000000000000000000000000000006", symbol: "WETH",
    factory: "0x6b9803efd7f39163af2ceb330ee58afbadd06751", launcher: "0x49FcA731F70DaF38d828E34204F2437E75a605a6" },
] as const;
export const testPool = (poolId?: string) => TEST_POOLS.find((pool) => pool.poolId.toLowerCase() === poolId?.toLowerCase());
