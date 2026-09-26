/** Base Sepolia only. Run from server with Bun; dry run unless --broadcast.
 * Requires PRIVATE_KEY, DEPLOYER, BASE_SEPOLIA_RPC_URL.
 * --fund additionally requires SWAPVM_INVENTORY (nWETH), SWAPVM_PRICE (nUSDC/nWETH).
 * The maker quote lasts one day. Re-run --fund to replenish/reprice it.
 */
import { createPublicClient, createWalletClient, encodeDeployData, http, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import { LIMITED_FACTORY } from "../../frontend/src/lib/limited-bids";
import { COVERAGE_TOKEN } from "../../frontend/src/lib/coverage-contracts";
if (!process.env.PRIVATE_KEY || !process.env.DEPLOYER) throw new Error("PRIVATE_KEY and DEPLOYER are required; load your existing contract environment locally");
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
if (!process.env.BASE_SEPOLIA_RPC_URL) throw new Error("BASE_SEPOLIA_RPC_URL is required");
const transport = http(process.env.BASE_SEPOLIA_RPC_URL);
const client = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
if (await client.getChainId() !== 84532) throw new Error("Base Sepolia only");
const file = new URL("../../frontend/src/lib/swapvm-deployment.json", import.meta.url);
const config = JSON.parse(readFileSync(file, "utf8"));
const broadcast = process.argv.includes("--broadcast");
const reads = parseAbi(["function app() view returns (address)", "function AQUA() view returns (address)"]);
const app = await client.readContract({ address: LIMITED_FACTORY, abi: reads, functionName: "app" });
const aqua = await client.readContract({ address: app, abi: reads, functionName: "AQUA" });
const save = () => writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
for (const [name, contract, args] of [
  ["router", "NacreSwapVMRouter", () => [aqua, config.asset, account.address]],
  ["market", "NacreSwapVMMarket", () => [aqua, config.router, config.asset, COVERAGE_TOKEN]],
  ["checkout", "NacreSwapVMCheckout", () => [LIMITED_FACTORY, config.market]],
] as const) {
  if (BigInt(config[name])) {
    if (!await client.getCode({ address: config[name] })) throw new Error(`${name} address has no code`);
    continue;
  }
  const artifact = JSON.parse(readFileSync(new URL(`../../contract/out/${contract}.sol/${contract}.json`, import.meta.url), "utf8"));
  const request = { abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: args() };
  if (!broadcast) {
    if (name === "router") {
      const gas = await client.estimateGas({ account, data: encodeDeployData(request) });
      console.log(JSON.stringify({ mode: "dry-run", next: name, gas: String(gas), remaining: "market, checkout", funding: "Separate maker inventory required" }));
    }
    break;
  }
  const hash = config[`${name}PendingTx`] ?? await wallet.deployContract(request);
  config[`${name}PendingTx`] = hash; save();
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed; inspect pending transaction`);
  config[name] = receipt.contractAddress; config[`${name}Tx`] = hash;
  delete config[`${name}PendingTx`]; save();
  console.log(JSON.stringify({ deployed: name, address: receipt.contractAddress, hash }));
}
if (process.argv.includes("--fund")) {
  if (!process.env.SWAPVM_INVENTORY || !process.env.SWAPVM_PRICE) throw new Error("Set SWAPVM_INVENTORY and SWAPVM_PRICE explicitly");
  const inventory = parseUnits(process.env.SWAPVM_INVENTORY, 18);
  const price = parseUnits(process.env.SWAPVM_PRICE, 6);
  if (inventory <= 0n || price <= 0n) throw new Error("Positive inventory and price required");
  if (!broadcast) { console.log(JSON.stringify({ mode: "dry-run", inventory: String(inventory), price: String(price) })); process.exit(0); }
  const abi = parseAbi(["function owner() view returns (address)", "function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function allowance(address,address) view returns (uint256)", "function fundQuote(uint128,uint128,uint40)"]);
  if ((await client.readContract({ address: config.market, abi, functionName: "owner" })).toLowerCase() !== account.address.toLowerCase()) throw new Error("Only the market owner can fund");
  if (await client.readContract({ address: config.asset, abi, functionName: "balanceOf", args: [account.address] }) < inventory) throw new Error("Insufficient nWETH inventory");
  let minimumBlock = 0n;
  const allowance = await client.readContract({ address: config.asset, abi, functionName: "allowance", args: [account.address, config.market] });
  if (allowance < inventory) {
    const approval = await wallet.writeContract({ address: config.asset as Address, abi, functionName: "approve", args: [config.market, inventory] });
    const receipt = await client.waitForTransactionReceipt({ hash: approval });
    if (receipt.status !== "success") throw new Error("Approval failed");
    minimumBlock = receipt.blockNumber;
  }
  let block = await client.getBlock();
  for (let attempt = 0; attempt < 15; attempt++) {
    const observed = block.number >= minimumBlock ? await client.readContract({ address: config.asset, abi, functionName: "allowance", args: [account.address, config.market], blockNumber: block.number }) : 0n;
    if (observed >= inventory) break;
    if (attempt === 14) throw new Error("Approval confirmed but RPC state is behind; retry funding later");
    await Bun.sleep(1000); block = await client.getBlock();
  }
  const call = { address: config.market as Address, abi, functionName: "fundQuote" as const, args: [inventory, price, Number(block.timestamp) + 86400] as const };
  await client.simulateContract({ ...call, account, blockNumber: block.number });
  const hash = await wallet.writeContract(call);
  if ((await client.waitForTransactionReceipt({ hash })).status !== "success") throw new Error("Funding failed");
  console.log(JSON.stringify({ funded: config.market, hash }));
}
