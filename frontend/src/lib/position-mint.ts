import { type Address, type Hex } from "viem";
import { baseClient, positionManagerAbi, UNISWAP_POSITION_MANAGER } from "./nacre-chain";

// Application budget for a single mint, not the chain's block gas limit.
// Normal mints are around 0.5M gas; never let a wallet choose a block-sized limit.
export const MAX_POSITION_MINT_GAS = BigInt(2_000_000);

export function positionMintGas(estimate: bigint): bigint {
  if (estimate <= BigInt(0)) throw new Error("The RPC returned an invalid mint gas estimate. Please retry.");
  if (estimate > MAX_POSITION_MINT_GAS) {
    throw new Error("This mint needs more gas than the application's safety limit. Refresh the pool and try again.");
  }
  const padded = (estimate * BigInt(130) + BigInt(99)) / BigInt(100) + BigInt(25_000);
  return padded > MAX_POSITION_MINT_GAS ? MAX_POSITION_MINT_GAS : padded;
}

export async function preparePositionMint(account: Address, unlockData: Hex) {
  const call = {
    account, address: UNISWAP_POSITION_MANAGER, abi: positionManagerAbi,
    functionName: "modifyLiquidities" as const,
    args: [unlockData, BigInt(Math.floor(Date.now() / 1000) + 600)] as const,
  };
  // Run after all approval receipts have confirmed. Failed estimation must
  // stop here rather than fall back to an oversized wallet gas setting.
  const estimate = await baseClient.estimateContractGas({ ...call, gas: MAX_POSITION_MINT_GAS });
  const gas = positionMintGas(estimate);
  await baseClient.simulateContract({ ...call, gas });
  return { ...call, gas };
}

export function positionMintError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/exceeds (max|maximum).*gas limit/i.test(message)) {
    return "The wallet submitted a gas limit above the RPC limit. Retry with the app’s estimated gas limit and remove any custom wallet gas limit.";
  }
  if (/0xf96fb071|InsufficientAllowance|0xd81b2f2e|AllowanceExpired/.test(message)) {
    return "The token spending approval is insufficient or expired. Retry the mint to refresh approvals before signing.";
  }
  if (reason instanceof Error && "shortMessage" in reason && typeof reason.shortMessage === "string") {
    return reason.shortMessage;
  }
  return reason instanceof Error ? reason.message : "Could not mint the position. Please retry.";
}
