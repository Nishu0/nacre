/** Faucet-token swaps only. Dry run unless --broadcast. See docs/test-pool-activity.md. */
import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, keccak256, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { mintParameters } from "../../frontend/src/lib/nacre-liquidity";
const UNISWAP_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3", UNISWAP_POSITION_MANAGER = "0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80", NACRE_REPEAT_FAUCET = "0x2EB148c4E526524E930a22788faa7e7c00eC425B";
const erc20Abi = parseAbi(["function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);
const permit2Abi = parseAbi(["function approve(address,address,uint160,uint48)"]);
const positionManagerAbi = parseAbi(["function modifyLiquidities(bytes,uint256) payable"]);
import { poolActivity } from "./pool-activity";
import deployment from "../../frontend/src/lib/bid-tools-deployment.json";
const option = (name: string, fallback: string) => { const index = process.argv.indexOf(name); return index < 0 ? fallback : process.argv[index + 1]; };
const fee = Number(option("--fee", "10000")), swaps = Number(option("--swaps", "10")), targetApr = Number(option("--target-apr", "6"));
const broadcast = process.argv.includes("--broadcast"), seed = process.argv.includes("--seed");
if (![100, 500, 3000, 10000].includes(fee) || !Number.isInteger(swaps) || swaps < 2 || swaps > 20 || targetApr <= 0 || targetApr > 100) throw new Error("Fee must be 100/500/3000/10000, swaps 2–20, target APR >0–100.");
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
const transport = http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org", { retryCount: 8, retryDelay: 1000 });
const client = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const weth = "0x3333C20E21Eeaed85766232B20641d56fd3788c4", usdc = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8";
const state = "0x571291b572ed32ce6751a2Cb2486EbEe8DEfB9B4";
const stateAbi = parseAbi(["function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)", "function getLiquidity(bytes32) view returns (uint128)"]);
const key = { currency0: weth, currency1: usdc, fee, tickSpacing: 10, hooks: "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00" } as const;
const poolId = keccak256(encodeAbiParameters([{ type: "tuple", components: [{ name: "currency0", type: "address" }, { name: "currency1", type: "address" }, { name: "fee", type: "uint24" }, { name: "tickSpacing", type: "int24" }, { name: "hooks", type: "address" }] }], [key]));
if (process.argv.includes("--pool-id") && option("--pool-id", "").toLowerCase() !== poolId) throw new Error("Pool ID does not match fee/key");
const response = await fetch(`http://127.0.0.1:3001/api/bid-market?poolId=${poolId}`);
if (!response.ok) throw new Error("Register the pool in the local API first");
const { market } = await response.json() as { market: { id: string; deployment: { txHash: Hex } } };
const router = deployment.swapBatch as Address;
if (!BigInt(router)) throw new Error("Deploy the test router first");
const artifact = JSON.parse(readFileSync(new URL("../../contract/out/NacreTestSwapBatch.sol/NacreTestSwapBatch.json", import.meta.url), "utf8"));
let slot = await client.readContract({ address: state, abi: stateAbi, functionName: "getSlot0", args: [poolId] });
const liquidity = await client.readContract({ address: state, abi: stateAbi, functionName: "getLiquidity", args: [poolId] });
if (!slot[0]) throw new Error("Pool not initialized");
let price = (Number(slot[0]) / 2 ** 96) ** 2 * 1e12;
const seedValue = Number(option("--seed-value", "1000"));
if (!Number.isFinite(seedValue) || seedValue < 100 || seedValue > 5000) throw new Error("Seed value must be 100–5000 nUSDC equivalent");
if (!liquidity && !seed) throw new Error("No active liquidity. Add --seed to mint a test LP first.");
let confirmedBlock: bigint | undefined;
const confirm = async (hash: Hex) => { const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 }); if (receipt.status !== "success") throw new Error(`Reverted: ${hash}`); confirmedBlock = receipt.blockNumber; console.log(JSON.stringify({ transaction: hash })); return receipt; };
const approve = async (token: Address, spender: Address, amount: bigint) => { const allowance = await client.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account.address, spender] }); if (allowance < amount) await confirm(await wallet.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount], gas: 100000n })); };
const claim = async (token: Address, needed: bigint) => {
  let balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  for (let i = 0; balance < needed && i < 3; i++) {
    await confirm(await wallet.writeContract({ address: token === weth ? weth : NACRE_REPEAT_FAUCET, abi: parseAbi(["function claim()"]), functionName: "claim", gas: 200000n }));
    balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [account.address] });
  }
  if (balance < needed) throw new Error("Faucet balance insufficient");
};
console.log(JSON.stringify({ mode: broadcast ? "broadcast" : "dry-run", poolId, fee, swaps, targetApr, seed: !liquidity && seed, seedValue, trader: account.address, warning: "Synthetic test activity; target is a one-window annualized run rate, not sustainable yield." }));
if (!liquidity && seed) {
  if (!broadcast) { console.log("Would seed test LP, then size swaps from measured liquidity. No transactions sent."); process.exit(0); }
  const w = parseUnits((seedValue / 2 / price).toFixed(18), 18), u = parseUnits((seedValue / 2).toFixed(6), 6);
  await claim(weth, w); await claim(usdc, u);
  for (const [token, amount] of [[weth, w], [usdc, u]] as const) {
    await approve(token, UNISWAP_PERMIT2, amount);
    await confirm(await wallet.writeContract({ address: UNISWAP_PERMIT2, abi: permit2Abi, functionName: "approve", args: [token, UNISWAP_POSITION_MANAGER, amount, Math.floor(Date.now() / 1000) + 3600], gas: 100000n }));
  }
  const params = mintParameters({ sqrtPriceX96: slot[0], lowerPriceUsd: price * .9, upperPriceUsd: price * 1.1, wethAmount: w, usdcAmount: u, recipient: account.address, wethToken: weth, fee });
  const receipt = await confirm(await wallet.writeContract({ address: UNISWAP_POSITION_MANAGER, abi: positionManagerAbi, functionName: "modifyLiquidities", args: [params.unlockData, BigInt(Math.floor(Date.now() / 1000) + 1200)], gas: 1800000n }));
  const registered = await fetch(`http://127.0.0.1:3001/api/markets/${market.id}/chain-positions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: receipt.transactionHash, account: account.address }) });
  if (!registered.ok) console.log(`LP minted; registration response: ${await registered.text()}`);
}
const activity = await poolActivity(poolId, market.deployment.txHash);
const desiredFees = activity.tvl * targetApr / 100 * activity.hours / 8760;
const remainingFees = Math.max(0, desiredFees - activity.grossFees);
const volume = process.argv.includes("--volume") ? Number(option("--volume", "0")) : remainingFees / (fee / 1e6);
if (!Number.isFinite(volume) || volume < 0 || volume > Math.min(500, activity.tvl * .05)) throw new Error("Volume must be ≤500 nUSDC and ≤5% of pool inventory value");
if (volume < .001) { console.log("Current activity already meets the target run rate; no swaps needed."); process.exit(0); }
slot = await client.readContract({ address: state, abi: stateAbi, functionName: "getSlot0", args: [poolId] });
price = (Number(slot[0]) / 2 ** 96) ** 2 * 1e12;
const perSwap = volume / swaps;
const trades = Array.from({ length: swaps }, (_, i) => {
  const zeroForOne = i % 2 === 0;
  return { zeroForOne, amountIn: zeroForOne ? parseUnits((perSwap / price).toFixed(18), 18) : parseUnits(perSwap.toFixed(6), 6), minimumOut: zeroForOne ? parseUnits((perSwap * (1 - fee / 1e6) * .98).toFixed(6), 6) : parseUnits((perSwap / price * (1 - fee / 1e6) * .98).toFixed(18), 18), priceLimit: zeroForOne ? slot[0] * 995n / 1000n : slot[0] * 1005n / 1000n };
});
if (trades.some((t) => t.amountIn <= 0n || t.minimumOut <= 0n)) throw new Error("Volume too small for token precision");
console.log(JSON.stringify({ tvl: activity.tvl, observedHours: activity.hours, existingFees: activity.grossFees, targetFees: desiredFees, additionalVolume: volume, estimatedAdditionalFees: volume * fee / 1e6 }));
if (!broadcast) process.exit(0);
const wInput = trades.filter((t) => t.zeroForOne).reduce((n, t) => n + t.amountIn, 0n), uInput = trades.filter((t) => !t.zeroForOne).reduce((n, t) => n + t.amountIn, 0n);
await claim(weth, wInput); await claim(usdc, uInput); await approve(weth, router, wInput); await approve(usdc, router, uInput);
const args = [key, trades, BigInt(Math.floor(Date.now() / 1000) + 1200)] as const;
// Public RPC backends can lag a just-confirmed approval. Simulate at its exact block,
// retrying reads while that block propagates instead of treating stale allowance as failure.
for (let attempt = 0; ; attempt++) {
  try { await client.simulateContract({ account, address: router, abi: artifact.abi, functionName: "execute", args, blockNumber: confirmedBlock }); break; }
  catch (error) { if (attempt >= 5) throw new Error((error as { shortMessage?: string }).shortMessage ?? "Swap simulation failed"); await Bun.sleep(1000); }
}
const receipt = await confirm(await wallet.writeContract({ address: router, abi: artifact.abi, functionName: "execute", args, gas: 2500000n }));
const event = parseAbi(["event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)"]);
let feeTotal = 0, count = 0;
for (const log of receipt.logs) { try { const { args: a } = decodeEventLog({ abi: event, topics: log.topics, data: log.data }); if (a.id !== poolId) continue; count++; const p = (Number(a.sqrtPriceX96) / 2 ** 96) ** 2 * 1e12; feeTotal += (a.amount0 < 0n ? -Number(a.amount0) / 1e18 * p : -Number(a.amount1) / 1e6) * a.fee / 1e6; } catch {} }
console.log(JSON.stringify({ generatedSwaps: count, grossFeeEstimate: feeTotal, transaction: receipt.transactionHash, synthetic: true }));
