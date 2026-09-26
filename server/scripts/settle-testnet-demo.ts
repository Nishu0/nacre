import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { replayAbi, replayDeployment, REPLAY_UNDERWRITER, REPLAY_INVESTOR } from "../../frontend/src/lib/illustrative-settlement";

// Defaults to read-only. Never falls back to the project's deployment key.
const args = process.argv.slice(2);
const hash = args.find((arg) => /^0x[\da-f]{64}$/i.test(arg)) as Hex | undefined;
if (!hash || args.includes("--help")) {
  console.log("bun server/scripts/settle-testnet-demo.ts DEPLOYMENT_TX_HASH [--broadcast]");
  console.log("Deploy and fund the separate demo in Portfolio first. Investor then pays its 1.80 premium.");
  console.log("Use the portfolio settlement button to sign with your wallet. Optional CLI broadcast requires NACRE_DEMO_SIGNER_KEY locally, belonging to one of the two demo wallets. Never share it in chat.");
  process.exit(hash ? 0 : args.includes("--help") ? 0 : 1);
}
const transport = http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org");
const client = createPublicClient({ chain: baseSepolia, transport });
if (await client.getChainId() !== 84532) throw new Error("Base Sepolia required.");
const [deployment, tx] = await Promise.all([
  client.getTransactionReceipt({ hash }), client.getTransaction({ hash }),
]);
if (deployment.status !== "success" || !deployment.contractAddress
  || tx.from.toLowerCase() !== REPLAY_UNDERWRITER.toLowerCase()
  || tx.input.toLowerCase() !== replayDeployment().toLowerCase()) {
  throw new Error("Deployment is not the expected illustrative contract from your underwriter wallet.");
}
const contract = { address: deployment.contractAddress, abi: replayAbi };
let stage = await client.readContract({ ...contract, functionName: "stage" });
console.log("Synthetic scenario: 10 target - 8.60 illustrative fees = 1.40 payout.");
console.log("Real test-token economics: 1.80 premium - 1.40 payout = 0.40 underwriter net, before gas.");
console.log(`Deployment: https://sepolia.basescan.org/tx/${hash}`);
if (args.includes("--broadcast") && stage !== 3) {
  if (stage !== 2) throw new Error("Funding and investor premium payment must complete first.");
  const key = process.env.NACRE_DEMO_SIGNER_KEY;
  if (!key || !/^0x[\da-f]{64}$/i.test(key)) throw new Error("Use the portfolio wallet button or configure NACRE_DEMO_SIGNER_KEY locally.");
  const account = privateKeyToAccount(key as Hex);
  if (![REPLAY_UNDERWRITER, REPLAY_INVESTOR].some((address) => address.toLowerCase() === account.address.toLowerCase())) {
    throw new Error("Signer must be one of the two specified demo wallets.");
  }
  const wallet = createWalletClient({ account, chain: baseSepolia, transport });
  const { request } = await client.simulateContract({ ...contract, account, functionName: "settle" });
  const settlementHash = await wallet.writeContract(request);
  console.log(`Submitted: https://sepolia.basescan.org/tx/${settlementHash}`);
  const receipt = await client.waitForTransactionReceipt({ hash: settlementHash });
  if (receipt.status !== "success") throw new Error("Settlement reverted.");
  stage = await client.readContract({ ...contract, functionName: "stage" });
}
const block = await client.readContract({ ...contract, functionName: "settlementBlock" });
if (stage === 3 && block) {
  const events = await client.getContractEvents({ ...contract, eventName: "IllustrativeSettlement", fromBlock: block, toBlock: block });
  const event = events.find((event) => event.args.actualPayout === 1_400_000n && event.args.collateralReturned === 8_600_000n);
  if (!event) throw new Error("Settlement amounts could not be verified.");
  console.log(`Confirmed 1.40 payout and 8.60 collateral return: https://sepolia.basescan.org/tx/${event.transactionHash}`);
  console.log("Both portfolio demo panels read this contract and refresh automatically. Existing LP policies remain unchanged.");
} else {
  console.log(`Stage ${stage}: no confirmed settlement yet. Complete the wallet steps in Portfolio.`);
}
