import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as Hex);
if (account.address.toLowerCase() !== process.env.DEPLOYER?.toLowerCase()) throw new Error("Deployer mismatch");
const transport = http(process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
const client = createPublicClient({ chain: baseSepolia, transport });
const wallet = createWalletClient({ account, chain: baseSepolia, transport });
console.log(JSON.stringify({ deployer: account.address, gasBalance: String(await client.getBalance({ address: account.address })) }));
if (!process.argv.includes("--broadcast")) process.exit(0);
const outputPath = new URL("../../frontend/src/lib/bid-tools-deployment.json", import.meta.url);
const output: Record<string, string> = existsSync(outputPath) ? JSON.parse(readFileSync(outputPath, "utf8")) : {};
for (const [name, key, args] of [["NacreLimitedOfferFactory", "limitedFactory", ["0x0D2ED632E5A10aB713d183369687720d4e3817Cd"]], ["NacreTestSwapBatch", "swapBatch", []]] as const) {
  if (output[key] && BigInt(output[key]) && await client.getCode({ address: output[key] as Hex })) { console.log(`${name} already deployed: ${output[key]}`); continue; }
  const source = name === "NacreLimitedOfferFactory" ? "NacreLimitedOffers.sol" : "NacreTestSwapBatch.sol";
  const artifact = JSON.parse(readFileSync(new URL(`../../contract/out/${source}/${name}.json`, import.meta.url), "utf8"));
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, gas: 8_000_000n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180000 });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed`);
  output[key] = receipt.contractAddress; output[`${key}Tx`] = hash;
  console.log(JSON.stringify({ name, address: receipt.contractAddress, hash }));
  writeFileSync(new URL("../../frontend/src/lib/bid-tools-deployment.json", import.meta.url), JSON.stringify({ chainId: 84532, ...output }, null, 2) + "\n");
}
