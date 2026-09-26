import { expect, test } from "bun:test";
import { createWalletClient, custom, BaseError } from "../frontend/node_modules/viem";
import { baseSepolia } from "../frontend/node_modules/viem/chains";
import { positionMintGas, positionMintError, MAX_POSITION_MINT_GAS } from "../frontend/src/lib/position-mint";
import { positionManagerAbi, UNISWAP_POSITION_MANAGER } from "../frontend/src/lib/nacre-chain";

test("mint gas adds headroom without allowing an oversized wallet limit", () => {
  expect(positionMintGas(463625n)).toBe(627713n);
  expect(positionMintGas(1_900_000n)).toBe(MAX_POSITION_MINT_GAS);
  expect(positionMintGas(MAX_POSITION_MINT_GAS)).toBe(MAX_POSITION_MINT_GAS);
  expect(() => positionMintGas(0n)).toThrow();
  expect(() => positionMintGas(MAX_POSITION_MINT_GAS + 1n)).toThrow();
});

test("injected wallet receives the explicit estimate as transaction gas", async () => {
  let submitted: Record<string, string> | undefined;
  const wallet = createWalletClient({ chain: baseSepolia, transport: custom({
    async request({ method, params }) {
      if (method === "eth_chainId") return "0x14a34";
      if (method === "eth_sendTransaction") {
        submitted = (params as Record<string, string>[])[0];
        return `0x${"a".repeat(64)}`;
      }
      throw new Error(`Unexpected request: ${method}`);
    },
  }) });
  await wallet.writeContract({ account: "0xec5660e8912dc26fc0e5ec700bf05b9f326d6288",
    address: UNISWAP_POSITION_MANAGER, abi: positionManagerAbi,
    functionName: "modifyLiquidities", args: ["0x", 1n], gas: positionMintGas(463625n) });
  expect(BigInt(submitted!.gas)).toBe(627713n);
  expect(submitted!.to.toLowerCase()).toBe(UNISWAP_POSITION_MANAGER.toLowerCase());
});

test("gas errors are readable while other execution failures stay visible", () => {
  expect(positionMintError(new Error("RPC: exceeds max transaction gas limit"))).toContain("estimated gas limit");
  expect(positionMintError(new Error("execution reverted: 0xf96fb071"))).toContain("refresh approvals");
  expect(positionMintError(new Error("Insufficient WETH"))).toBe("Insufficient WETH");
  expect(positionMintError(new BaseError("Simulation reverted"))).toBe("Simulation reverted");
});
