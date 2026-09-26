import { encodeAbiParameters, encodeDeployData, keccak256, parseAbi, parseAbiParameters, parseUnits, type Hex } from "viem";
import artifact from "./nacre-open-pool-artifact.json";
import { NACRE_TEST_WETH } from "./test-pools";
export const OPEN_POOL_FEES = [100, 500, 3000, 10000] as const;
export const OPEN_POOL_MANAGER = "0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408" as const;
export const openPoolAbi = parseAbi([
  "constructor(uint24 fee,uint160 sqrtPriceX96)",
  "event PoolCreated(bytes32 indexed poolId,address indexed creator,address offerFactory,uint24 fee,uint160 sqrtPriceX96,int24 tick)",
]);
export const poolInitializeAbi = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
export const openPoolBytecode = artifact.bytecode as Hex;
export function openPoolKey(fee: number) {
  if (!OPEN_POOL_FEES.includes(fee as typeof OPEN_POOL_FEES[number])) throw new Error("Unsupported trading fee.");
  return { currency0: NACRE_TEST_WETH, currency1: "0xfa35D165b03B8eB193934D338Db8de536e84AAC8" as const,
    fee, tickSpacing: 10, hooks: "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00" as const };
}
export function openPoolId(fee: number) {
  return keccak256(encodeAbiParameters(parseAbiParameters("(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)"), [openPoolKey(fee)]));
}
export function startingSqrtPrice(value: string): bigint {
  const price = Number(value);
  if (!value.trim() || !Number.isFinite(price) || price < .01 || price > 1_000_000) throw new Error("Enter a starting price between $0.01 and $1,000,000.");
  // 18-decimal nWETH / 6-decimal nUSDC. Integer square root rounds down.
  const n = parseUnits(price.toFixed(18), 18) * (1n << 192n) / (10n ** 30n);
  let x = n, next = (x + 1n) / 2n;
  while (next < x) { x = next; next = (x + n / x) / 2n; }
  return x;
}
export const openPoolDeploymentData = (fee: number, sqrtPrice: bigint) => encodeDeployData({
  abi: openPoolAbi, bytecode: openPoolBytecode, args: [fee, sqrtPrice],
});
