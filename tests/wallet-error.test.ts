import { expect, test } from "bun:test";
import { walletErrorMessage } from "../frontend/src/lib/wallet-error";

test("plain provider failures retain their reason", () => {
  expect(walletErrorMessage({ message: "Wallet disconnected" }, "fallback")).toBe("Wallet disconnected");
  expect(walletErrorMessage({ code: 4001 }, "fallback")).toContain("cancelled");
  expect(walletErrorMessage({ shortMessage: "Transaction failed", cause: { message: "insufficient funds for gas * price + value" } }, "fallback")).toContain("Base Sepolia ETH");
  expect(walletErrorMessage(new Error("RPC unavailable"), "fallback")).toBe("RPC unavailable");
  expect(walletErrorMessage(null, "fallback")).toBe("fallback");
  const cycle: { cause?: unknown } = {}; cycle.cause = cycle;
  expect(walletErrorMessage(cycle, "fallback")).toBe("fallback");
});
