import { getHyperliquidHistory } from "./hyperliquid";

export type AssetQuote = { usd: number; publishedAt: string; confidenceUsd?: number };
export type LivePrices = {
  source: "Pyth" | "Chainlink" | "Hyperliquid";
  quoteBasis?: "ETH perpetual trades / USDC";
  network: string;
  sourceUrl: string;
  fetchedAt: string;
  assets: { WETH: AssetQuote; USDC: AssetQuote };
  wethUsdc: number;
};

function assertFresh(timestamp: number, maxAgeSeconds: number, now = Date.now()): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now / 1000 + 30
    || now / 1000 - timestamp > maxAgeSeconds) throw new Error("Oracle price is stale");
  return new Date(timestamp * 1000).toISOString();
}

export function parsePythPrice(entry: unknown, expectedId: string, now = Date.now()): AssetQuote {
  if (!entry || typeof entry !== "object") throw new Error("Pyth feed missing");
  const feed = entry as { id?: string; price?: {
    price?: string; expo?: number; conf?: string; publish_time?: number;
  } };
  if (feed.id?.replace(/^0x/, "").toLowerCase() !== expectedId) throw new Error("Pyth feed ID mismatch");
  const raw = feed.price;
  const expo = raw?.expo;
  if (!raw || typeof expo !== "number" || !Number.isInteger(expo) || Math.abs(expo) > 18) {
    throw new Error("Invalid Pyth exponent");
  }
  const usd = Number(raw.price) * 10 ** expo;
  const confidenceUsd = Number(raw.conf) * 10 ** expo;
  if (!Number.isFinite(usd) || usd <= 0 || !Number.isFinite(confidenceUsd)
    || confidenceUsd < 0 || confidenceUsd / usd > 0.05) throw new Error("Invalid Pyth quote");
  return { usd, confidenceUsd, publishedAt: assertFresh(Number(raw.publish_time), 90, now) };
}

export function parseChainlinkRound(result: unknown, decimals: number, maxAgeSeconds: number,
  now = Date.now()): AssetQuote {
  if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result) || result.length < 2 + 64 * 5
    || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new Error("Invalid Chainlink round");
  const words = result.slice(2).match(/.{64}/g);
  if (!words || words.length < 5) throw new Error("Invalid Chainlink round");
  const answer = BigInt.asIntN(256, BigInt(`0x${words[1]}`));
  const updatedAt = Number(BigInt(`0x${words[3]}`));
  const answeredInRound = BigInt(`0x${words[4]}`);
  const roundId = BigInt(`0x${words[0]}`);
  const usd = Number(answer) / 10 ** decimals;
  if (answer <= 0n || answeredInRound < roundId || !Number.isFinite(usd) || usd <= 0) {
    throw new Error("Invalid Chainlink answer");
  }
  return { usd, publishedAt: assertFresh(updatedAt, maxAgeSeconds, now) };
}

export async function getLivePrices(): Promise<LivePrices> {
  const history = await getHyperliquidHistory();
  const latest = history.points.at(-1)!;
  const publishedAt = latest.timestamp;
  return {
    source: "Hyperliquid", network: "Hyperliquid mainnet",
    sourceUrl: "https://app.hyperliquid.xyz/trade/ETH",
    quoteBasis: "ETH perpetual trades / USDC",
    fetchedAt: new Date().toISOString(),
    // USDC is the quote denomination, not a separately observed dollar oracle.
    assets: { WETH: { usd: latest.priceUsdc, publishedAt }, USDC: { usd: 1, publishedAt } },
    wethUsdc: latest.priceUsdc,
  };
}
