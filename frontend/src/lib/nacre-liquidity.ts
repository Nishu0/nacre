import { encodeAbiParameters, type Address, type Hex } from "viem";
const BASE_WETH = "0x4200000000000000000000000000000000000006";
const NACRE_TEST_USDC = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8";
const NACRE_HOOK = "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00";
export function priceToRawTick(priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("Invalid position bound.");
  const wethFirst = BigInt(BASE_WETH.toLowerCase()) < BigInt(NACRE_TEST_USDC.toLowerCase());
  const rawPrice = wethFirst ? priceUsd * 1e-12 : 1e12 / priceUsd;
  return Math.floor(Math.log(rawPrice) / Math.log(1.0001) / 10 + 1e-9) * 10;
}

function approximateSqrtAtTick(tick: number): bigint {
  return BigInt(Math.floor(Math.pow(1.0001, tick / 2) * 2 ** 96));
}

export function mintParameters(input: { fee?: number;
  sqrtPriceX96: bigint; lowerPriceUsd: number; upperPriceUsd: number;
  wethAmount: bigint; usdcAmount: bigint; recipient: Address; wethToken?: Address;
}) {
  const wethToken = input.wethToken ?? BASE_WETH;
  if (BigInt(wethToken) >= BigInt(NACRE_TEST_USDC)) throw new Error("Unsupported pool token ordering.");
  const lowerTick = priceToRawTick(input.lowerPriceUsd);
  const upperTick = priceToRawTick(input.upperPriceUsd);
  if (lowerTick >= upperTick) throw new Error("Position range is narrower than one Uniswap tick spacing.");
  const q96 = BigInt(2) ** BigInt(96);
  const sqrtA = approximateSqrtAtTick(lowerTick);
  const sqrtB = approximateSqrtAtTick(upperTick);
  const sqrtP = input.sqrtPriceX96;
  let liquidity: bigint;
  if (sqrtP <= sqrtA) {
    liquidity = input.wethAmount * ((sqrtA * sqrtB) / q96) / (sqrtB - sqrtA);
  } else if (sqrtP >= sqrtB) {
    liquidity = input.usdcAmount * q96 / (sqrtB - sqrtA);
  } else {
    const byWeth = input.wethAmount * ((sqrtP * sqrtB) / q96) / (sqrtB - sqrtP);
    const byUsdc = input.usdcAmount * q96 / (sqrtP - sqrtA);
    liquidity = byWeth < byUsdc ? byWeth : byUsdc;
  }
  liquidity = liquidity * BigInt(99) / BigInt(100);
  if (liquidity <= BigInt(0)) throw new Error("Amount is too small for this position range.");
  const wethFirst = BigInt(BASE_WETH.toLowerCase()) < BigInt(NACRE_TEST_USDC.toLowerCase());
  const currency0 = wethFirst ? wethToken : NACRE_TEST_USDC;
  const currency1 = wethFirst ? NACRE_TEST_USDC : wethToken;
  const amount0Max = wethFirst ? input.wethAmount : input.usdcAmount;
  const amount1Max = wethFirst ? input.usdcAmount : input.wethAmount;
  const poolKey = { currency0, currency1, fee: input.fee ?? 500, tickSpacing: 10, hooks: NACRE_HOOK } as const;
  const mint = encodeAbiParameters([
    { type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] },
    { type: "int24" }, { type: "int24" }, { type: "uint256" }, { type: "uint128" }, { type: "uint128" },
    { type: "address" }, { type: "bytes" },
  ], [poolKey, lowerTick, upperTick, liquidity, amount0Max, amount1Max, input.recipient, "0x"]);
  const settle = encodeAbiParameters([{ type: "address" }, { type: "address" }], [currency0, currency1]);
  const unlockData = encodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], ["0x020d", [mint, settle]]);
  return { lowerTick, upperTick, liquidity, amount0Max, amount1Max, unlockData: unlockData as Hex };
}

