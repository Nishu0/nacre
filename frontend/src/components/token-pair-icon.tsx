import TokenETH from "@web3icons/react/icons/tokens/TokenETH";
import TokenUSDC from "@web3icons/react/icons/tokens/TokenUSDC";
import TokenUSDT from "@web3icons/react/icons/tokens/TokenUSDT";

type TokenSymbol = "ETH" | "USDC" | "USDT";

function normalizeSymbol(value: string): TokenSymbol | null {
  const symbol = value.trim().toUpperCase();
  if (symbol === "WETH" || symbol === "NWETH" || symbol === "ETH") return "ETH";
  if (symbol === "USDC" || symbol === "NUSDC") return "USDC";
  if (symbol === "USDT") return "USDT";
  return null;
}

function TokenMark({ symbol }: { symbol: string }) {
  const normalized = normalizeSymbol(symbol);
  const tokenClass = normalized?.toLowerCase() ?? "unknown";

  return (
    <span className={`token-pair-mark token-pair-mark--${tokenClass}`}>
      {normalized === "ETH" && <TokenETH variant="mono" aria-hidden="true" />}
      {normalized === "USDC" && <TokenUSDC variant="mono" aria-hidden="true" />}
      {normalized === "USDT" && <TokenUSDT variant="mono" aria-hidden="true" />}
      {!normalized && <span className="token-pair-fallback">{symbol.trim().slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}

/** A compact token pair mark; the adjacent pair label supplies its accessible name. */
export function TokenPairIcon({ pair, size = "default" }: { pair: string; size?: "default" | "small" | "large" }) {
  const [first = "ETH", second = "USDC"] = pair.split("/");

  return (
    <span className={`token-pair-icon token-pair-icon--${size}`} aria-hidden="true">
      <TokenMark symbol={first} />
      <TokenMark symbol={second} />
    </span>
  );
}
