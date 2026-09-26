import { createPublicClient, createWalletClient, custom, encodeAbiParameters, http, parseAbi, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";

export const NACRE_ADMIN = "0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288" as Address;
export const NACRE_TEST_USDC = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8" as Address;
export const NACRE_REPEAT_FAUCET = "0x2EB148c4E526524E930a22788faa7e7c00eC425B" as Address;
export const NACRE_LAUNCHER = "0x49FcA731F70DaF38d828E34204F2437E75a605a6" as Address;
export const NACRE_HOOK = "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00" as Address;
export const NACRE_VAULT = "0x879ead283e76afc12865ca43a0a3f10c3626cce0" as Address;
export const BASE_WETH = "0x4200000000000000000000000000000000000006" as Address;
export const UNISWAP_POSITION_MANAGER = "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80" as Address;
export const UNISWAP_STATE_VIEW = "0x571291b572ed32ce6751a2cb2486ebee8defb9b4" as Address;
export const UNISWAP_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address;

export const faucetAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const repeatFaucetAbi = parseAbi(["function claim()"]);
export const launcherAbi = parseAbi([
  "function initialize(uint160 sqrtPriceX96) returns (int24)",
  "function launched() view returns (bool)",
  "function poolId() view returns (bytes32)",
  "function admin() view returns (address)",
  "event PoolLaunched(bytes32 indexed poolId, uint160 sqrtPriceX96, int24 tick, address indexed admin)",
]);
export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const wethAbi = parseAbi(["function deposit() payable"]);
export const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);
export const positionManagerAbi = parseAbi([
  "function modifyLiquidities(bytes unlockData,uint256 deadline) payable",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);

export const baseClient = createPublicClient({ chain: baseSepolia, transport: http("https://sepolia.base.org") });

export function injectedClient() {
  if (!window.ethereum) throw new Error("Install a wallet to send Base Sepolia transactions.");
  return createWalletClient({ chain: baseSepolia, transport: custom(window.ethereum) });
}

export async function ensureBaseSepolia() {
  if (!window.ethereum) throw new Error("Install a wallet to send Base Sepolia transactions.");
  const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
  if (Number.parseInt(chainId, 16) === baseSepolia.id) return;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902) throw error;
    await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x14a34", chainName: "Base Sepolia", rpcUrls: ["https://sepolia.base.org"], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorerUrls: ["https://sepolia.basescan.org"] }] });
  }
}

function integerSqrt(value: bigint): bigint {
  if (value < BigInt(2)) return value;
  let x = BigInt(1) << BigInt(Math.ceil(value.toString(2).length / 2));
  while (true) {
    const next = (x + value / x) >> BigInt(1);
    if (next >= x) return x;
    x = next;
  }
}

/** Uniswap's raw token1/token0 sqrt ratio, with WETH 18 and nUSDC 6 decimals. */
export function wethPriceToSqrtX96(priceUsd: number): bigint {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 1_000_000) throw new Error("Invalid opening price.");
  const microUsdcPerWeth = BigInt(Math.round(priceUsd * 1_000_000));
  const wethFirst = BigInt(BASE_WETH.toLowerCase()) < BigInt(NACRE_TEST_USDC.toLowerCase());
  const numerator = wethFirst ? microUsdcPerWeth : BigInt("1000000000000000000");
  const denominator = wethFirst ? BigInt("1000000000000000000") : microUsdcPerWeth;
  return integerSqrt((numerator << BigInt(192)) / denominator);
}

/** Base Sepolia demo pair has WETH as currency0 and six-decimal nUSDC as currency1. */
export function sqrtPriceX96ToWethUsd(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 <= BigInt(0)) throw new Error("The v4 pool is not initialized.");
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  return ratio * ratio * 1e12;
}

export function priceToRawTick(priceUsd: number): number {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error("Invalid position bound.");
  const wethFirst = BigInt(BASE_WETH.toLowerCase()) < BigInt(NACRE_TEST_USDC.toLowerCase());
  const rawPrice = wethFirst ? priceUsd * 1e-12 : 1e12 / priceUsd;
  return Math.floor(Math.log(rawPrice) / Math.log(1.0001) / 10 + 1e-9) * 10;
}

function approximateSqrtAtTick(tick: number): bigint {
  return BigInt(Math.floor(Math.pow(1.0001, tick / 2) * 2 ** 96));
}

export function mintParameters(input: {
  sqrtPriceX96: bigint; lowerPriceUsd: number; upperPriceUsd: number;
  wethAmount: bigint; usdcAmount: bigint; recipient: Address;
}) {
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
  const currency0 = wethFirst ? BASE_WETH : NACRE_TEST_USDC;
  const currency1 = wethFirst ? NACRE_TEST_USDC : BASE_WETH;
  const amount0Max = wethFirst ? input.wethAmount : input.usdcAmount;
  const amount1Max = wethFirst ? input.usdcAmount : input.wethAmount;
  const poolKey = { currency0, currency1, fee: 500, tickSpacing: 10, hooks: NACRE_HOOK };
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

export const basescanTx = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
