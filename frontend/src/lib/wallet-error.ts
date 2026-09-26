/** Wallet providers can reject with plain objects rather than Error instances. */
export function walletErrorMessage(reason: unknown, fallback: string): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  let current = reason;
  let rejected = false;
  for (let depth = 0; current && depth < 8 && !seen.has(current); depth++) {
    seen.add(current);
    if (typeof current === "string") { messages.push(current); break; }
    if (typeof current !== "object") break;
    const error = current as { code?: number; shortMessage?: string; message?: string; details?: string; cause?: unknown; error?: unknown; data?: { originalError?: unknown } };
    rejected ||= error.code === 4001;
    for (const text of [error.shortMessage, error.message, error.details]) if (typeof text === "string" && text.trim()) messages.push(text);
    current = error.cause ?? error.error ?? error.data?.originalError;
  }
  const combined = messages.join(" ");
  if (rejected || /user rejected|user denied/i.test(combined)) return "Request cancelled in your wallet. You can try again.";
  if (/insufficient funds|insufficient balance.*gas|exceeds.*balance/i.test(combined)) return "Add Base Sepolia ETH to this wallet for network gas, then retry. Test tokens are free, but claiming requires gas.";
  return messages[0] || fallback;
}
