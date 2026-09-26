/** Add atomic checkout without replacing any existing funded bid or policy. */
import { createPublicClient, createWalletClient, encodeDeployData, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import { LIMITED_FACTORY } from "../../frontend/src/lib/limited-bids";
import { atomicCheckoutAbi } from "../../frontend/src/lib/atomic-checkout";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
const transport = http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
const client = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
if (await client.getChainId() !== 84532) throw new Error("Base Sepolia only");
const file = new URL("../../frontend/src/lib/atomic-checkout-deployment.json", import.meta.url);
const output = JSON.parse(readFileSync(file, "utf8"));
if (BigInt(output.checkout)) {
  const factory = await client.readContract({ address: output.checkout, abi: atomicCheckoutAbi, functionName: "bidFactory" });
  if (factory.toLowerCase() !== LIMITED_FACTORY.toLowerCase()) throw new Error("Existing checkout has another bid factory");
  console.log(JSON.stringify({ alreadyDeployed: output.checkout })); process.exit(0);
}
const artifact = JSON.parse(readFileSync(new URL("../../contract/out/NacreAtomicCheckout.sol/NacreAtomicCheckout.json", import.meta.url), "utf8"));
const request = { abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: [LIMITED_FACTORY] };
const estimate = await client.estimateGas({ account, data: encodeDeployData(request) });
const gas = estimate * 120n / 100n;
if (gas > 6_000_000n) throw new Error("Deployment exceeds gas budget");
console.log(JSON.stringify({ deployer: account.address, gas: String(gas), bidFactory: LIMITED_FACTORY }));
if (!process.argv.includes("--broadcast")) process.exit(0);
const hash = (output.pendingTx ?? await wallet.deployContract({ ...request, gas })) as Hex;
output.pendingTx = hash; writeFileSync(file, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ submitted: hash }));
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Checkout deployment failed");
let verified = false;
for (let i = 0; i < 10; i++) {
  try {
    const factory = await client.readContract({ address: receipt.contractAddress, abi: atomicCheckoutAbi, functionName: "bidFactory", blockNumber: receipt.blockNumber });
    verified = factory.toLowerCase() === LIMITED_FACTORY.toLowerCase();
    if (verified) break;
  } catch { /* A newly mined contract may lag on another RPC replica. */ }
  await Bun.sleep(1500);
}
if (!verified) throw new Error("Deployment confirmed; rerun to verify pendingTx, do not redeploy");
output.checkout = receipt.contractAddress; output.txHash = hash; output.blockNumber = String(receipt.blockNumber);
output.bidFactory = LIMITED_FACTORY; delete output.pendingTx;
writeFileSync(file, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));
