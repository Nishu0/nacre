/** Seed one flexible Base Sepolia demo bid. Old wallet-owned bids are untouched.
 * Dry-run by default; use --fork --broadcast to test locally before --broadcast.
 */
import { createPublicClient, createWalletClient, decodeEventLog, encodeFunctionData, http, parseAbi, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, foundry } from "viem/chains";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { LIMITED_FACTORY, limitedFactoryAbi } from "../../frontend/src/lib/limited-bids";
const pool = "0x03be77c419a9a391c642576e5468d32ba21250f59d750be76e1043efe50c5a16" as const;
const token = "0xfa35D165b03B8eB193934D338Db8de536e84AAC8" as const;
const fork = process.argv.includes("--fork"), broadcast = process.argv.includes("--broadcast");
const chain = fork ? foundry : baseSepolia;
const rpc = fork ? "http://127.0.0.1:8547" : process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
const client = createPublicClient({ chain, transport: http(rpc, { timeout: 60_000 }) });
const wallet = createWalletClient({ chain, account, transport: http(rpc) });
if (await client.getChainId() !== chain.id) throw new Error("Unexpected chain");
const offerAbi = parseAbi(["function owner() view returns (address)", "function supportsSubranges() pure returns (bool)"]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)"]);
const bid = { fee: 10000, amount: 100_000_000n, lower: -198410, upper: -196400, duration: 2592000, premiumBps: 434, cap: 10_000_000n, spots: 10 };
if (!await client.readContract({ address: LIMITED_FACTORY, abi: limitedFactoryAbi, functionName: "supportsSubranges" })) throw new Error("Factory is not flexible");
const dir = new URL("../../.deploy/", import.meta.url);
mkdirSync(dir, { recursive: true });
const file = new URL(`flexible-test-bid${fork ? "-fork" : ""}.json`, dir);
type State = { chainId: number; factory: Address; owner: Address; hashes: Record<string, Hex>; offer?: Address };
const state: State = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { chainId: chain.id, factory: LIMITED_FACTORY, owner: account.address, hashes: {} };
if (state.chainId !== chain.id || state.factory !== LIMITED_FACTORY || state.owner !== account.address) throw new Error("Seed journal mismatch");
if (!state.hashes.create) {
  // Do not seed another offer if this deployment wallet already funded one.
  const count = await client.readContract({ address: LIMITED_FACTORY, abi: limitedFactoryAbi, functionName: "offerCount", args: [pool] });
  if (count > 100n) throw new Error("Too many offers to scan");
  for (let i = 0n; i < count; i++) {
    const offer = await client.readContract({ address: LIMITED_FACTORY, abi: limitedFactoryAbi, functionName: "offers", args: [pool, i] });
    const owner = await client.readContract({ address: offer, abi: offerAbi, functionName: "owner" });
    if (owner.toLowerCase() === account.address.toLowerCase()) throw new Error(`Deployer already funded ${offer}; do not duplicate`);
  }
  const balance = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (balance < bid.amount) throw new Error("Insufficient test nUSDC");
}
console.log(JSON.stringify({ chainId: chain.id, owner: account.address, ...bid }, (_, v) => typeof v === "bigint" ? String(v) : v));
if (!broadcast) process.exit(0);
const save = () => writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
save();
async function send(step: string, to: Address, data: Hex) {
  if (!state.hashes[step]) {
    let gas = 0n;
    for (let attempt = 0; attempt < 8; attempt++) {
      try { gas = await client.estimateGas({ account, to, data }); break; }
      catch { if (attempt === 7) throw new Error(`Cannot estimate ${step}; inspect RPC before resuming`); await Bun.sleep(1500); }
    }
    gas = gas * 120n / 100n + 25_000n;
    if (gas > 16_000_000n) throw new Error("Gas exceeds transaction limit");
    state.hashes[step] = await wallet.sendTransaction({ to, data, gas });
    save();
  }
  const receipt = await client.waitForTransactionReceipt({ hash: state.hashes[step], timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${step} reverted; inspect the saved transaction`);
  console.log(JSON.stringify({ step, hash: receipt.transactionHash }));
  return receipt;
}
await send("approve", token, encodeFunctionData({ abi: erc20, functionName: "approve", args: [LIMITED_FACTORY, bid.amount] }));
const receipt = await send("create", LIMITED_FACTORY, encodeFunctionData({ abi: limitedFactoryAbi, functionName: "createOffers", args: [[bid]] }));
const eventAbi = parseAbi(["event LimitedOfferCreated(bytes32 indexed poolId,address indexed offer,address indexed owner,uint256 amount,uint256 cap,uint16 spots)"]);
for (const log of receipt.logs.filter((log) => log.address.toLowerCase() === LIMITED_FACTORY.toLowerCase())) {
  try {
    const { args } = decodeEventLog({ abi: eventAbi, topics: log.topics, data: log.data });
    if (args.poolId === pool && args.owner.toLowerCase() === account.address.toLowerCase()) state.offer = args.offer;
  } catch { /* Ignore unrelated events. */ }
}
if (!state.offer) throw new Error("Offer event missing; inspect receipt before retrying");
save();
for (let attempt = 0; ; attempt++) {
  try {
    const flexible = await client.readContract({ address: state.offer, abi: offerAbi, functionName: "supportsSubranges", blockNumber: receipt.blockNumber });
    const balance = await client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [state.offer], blockNumber: receipt.blockNumber });
    const allowance = await client.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account.address, LIMITED_FACTORY], blockNumber: receipt.blockNumber });
    if (!flexible || balance !== bid.amount || allowance !== 0n) throw new Error("Seed verification failed");
    break;
  } catch (error) { if (attempt >= 7) throw error; await Bun.sleep(1500); }
}
console.log(JSON.stringify({ offer: state.offer, flexible: true, funded: "100 nUSDC", spots: bid.spots }));
