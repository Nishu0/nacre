"use client";
import { useEffect, useState } from "react";
import { baseClient } from "./nacre-chain";
import { SWAPVM_CHECKOUT, SWAPVM_ASSET, swapVMAbi, swapInputLimit, type SingleTokenQuote } from "./swapvm";
export function useSingleTokenQuote(enabled: boolean, asset: string, amountOut: bigint, refresh: number) {
  const [state, setState] = useState<{ key: string; quote?: SingleTokenQuote; error?: string } | null>(null);
  const key = `${asset.toLowerCase()}:${amountOut}`;
  useEffect(() => {
    if (!enabled || amountOut <= 0n || !BigInt(SWAPVM_CHECKOUT) || asset.toLowerCase() !== SWAPVM_ASSET.toLowerCase()) return;
    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    async function update() {
      try {
        const [amountIn, orderHash, expiry] = await baseClient.readContract({ address: SWAPVM_CHECKOUT, abi: swapVMAbi, functionName: "quoteSwap", args: [amountOut] });
        const expiresAt = Math.min(expiry, Math.floor(Date.now() / 1000) + 60);
        if (expiresAt <= Date.now() / 1000) throw new Error("Expired quote");
        if (!cancelled) {
          clearTimeout(expiryTimer);
          setState({ key, quote: { amountIn: String(amountIn), maxInput: String(swapInputLimit(amountIn)), orderHash, amountOut: String(amountOut), expiresAt } });
          expiryTimer = setTimeout(() => { if (!cancelled) setState({ key, error: "Swap quote expired. Refresh or supply both tokens." }); }, Math.max(0, expiresAt * 1000 - Date.now()));
        }
      } catch {
        if (!cancelled) setState({ key, error: "No funded swap quote is available. Refresh or supply both tokens." });
      }
    }
    void update(); const timer = setInterval(update, 15000);
    return () => { cancelled = true; clearInterval(timer); clearTimeout(expiryTimer); };
  }, [enabled, asset, amountOut, refresh, key]);
  if (!enabled) return { quote: null, error: "" };
  if (!BigInt(SWAPVM_CHECKOUT)) return { quote: null, error: "Single token supply is awaiting its testnet deployment and funded swap quote." };
  if (asset.toLowerCase() !== SWAPVM_ASSET.toLowerCase()) return { quote: null, error: "Single token supply is not available for this pool yet." };
  return { quote: state?.key === key ? state.quote ?? null : null, error: state?.key === key ? state.error ?? "" : "" };
}
