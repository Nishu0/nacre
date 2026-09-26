/** Upgrade the testnet bid factory while retaining every existing funded offer. */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync } from "node:fs";
import { limitedFactoryAbi } from "../../frontend/src/lib/limited-bids";
import { COVERAGE_APP } from "../../frontend/src/lib/coverage-contracts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
const transport = http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
const client = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
const outputPath = new URL("../../frontend/src/lib/bid-tools-deployment.json", import.meta.url);
const output = JSON.parse(readFileSync(outputPath, "utf8"));
const supports = await client.readContract({ address: output.limitedFactory, abi: limitedFactoryAbi, functionName: "supportsSubranges" }).catch(() => false);
if (supports) { console.log(`Subrange factory already active: ${output.limitedFactory}`); process.exit(0); }
const artifact = JSON.parse(readFileSync(new URL("../../contract/out/NacreLimitedOffers.sol/NacreLimitedOfferFactory.json", import.meta.url), "utf8"));
const request = { abi: artifact.abi, bytecode: artifact.bytecode.object as Hex, args: [COVERAGE_APP] };
// Estimate contract creation directly; never copy a block-sized gas limit.
const { encodeDeployData } = await import("viem");
const gasEstimate = await client.estimateGas({ account, data: encodeDeployData(request) });
const gas = gasEstimate * 120n / 100n;
if (gas > 16_000_000n) throw new Error("Deployment gas exceeds testnet transaction budget");
console.log(JSON.stringify({ deployer: account.address, gas: String(gas), previousFactory: output.limitedFactory }));
if (!process.argv.includes("--broadcast")) process.exit(0);
const resume = process.argv.find((arg) => arg.startsWith("--resume="))?.slice(9) ?? output.pendingSubrangeFactoryTx;
const hash = (resume ?? await wallet.deployContract({ ...request, gas })) as Hex;
output.pendingSubrangeFactoryTx = hash;
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ submitted: hash }));
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Subrange factory deployment failed");
let verified = false;
for (let attempt = 0; attempt < 8; attempt++) {
  try {
    verified = await client.readContract({ address: receipt.contractAddress, abi: limitedFactoryAbi,
      functionName: "supportsSubranges", blockNumber: receipt.blockNumber });
    if (verified) break;
  } catch { /* RPC replicas can trail the freshly confirmed creation block. */ }
  await Bun.sleep(1500);
}
if (!verified) throw new Error(`Factory verification is pending. Resume with --broadcast --resume=${hash}; do not redeploy.`);
delete output.pendingSubrangeFactoryTx;
output.legacyLimitedFactories = [...new Set([...(output.legacyLimitedFactories ?? []), output.limitedFactory])];
output.limitedFactory = receipt.contractAddress;
output.limitedFactoryTx = hash;
writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ address: receipt.contractAddress, hash, preservedFactories: output.legacyLimitedFactories }));
