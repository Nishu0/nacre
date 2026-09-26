// Market reference quotes only. Sandbox coverage is still priced from its
// recorded tick; no API result here is submitted to an on-chain contract.
const PYTH_FEEDS = {
  WETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  USDC: "eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
} as const;
const CHAINLINK_FEEDS = {
  WETH: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  USDC: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
} as const;
const CHAINLINK_RPC = process.env.CHAINLINK_ETHEREUM_RPC_URL ?? "https://ethereum.publicnode.com";
const PYTH_URL = "https://pyth.dourolabs.app/hermes/v2/updates/price/latest";

export type AssetQuote = { usd: number; publishedAt: string; confidenceUsd?: number };
export type LivePrices = {
  source: "Pyth" | "Chainlink";
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

async function fetchPyth(key: string): Promise<LivePrices> {
  const url = new URL(PYTH_URL);
  for (const id of Object.values(PYTH_FEEDS)) url.searchParams.append("ids[]", `0x${id}`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(6000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Pyth HTTP ${response.status}`);
  const body = await response.json() as { parsed?: unknown[] };
  const entries = body.parsed ?? [];
  const find = (id: string) => entries.find((item) =>
    (item as { id?: string })?.id?.replace(/^0x/, "").toLowerCase() === id);
  const WETH = parsePythPrice(find(PYTH_FEEDS.WETH), PYTH_FEEDS.WETH);
  const USDC = parsePythPrice(find(PYTH_FEEDS.USDC), PYTH_FEEDS.USDC);
  return {
    source: "Pyth", network: "Pyth Core", sourceUrl: "https://www.pyth.network/price-feeds",
    fetchedAt: new Date().toISOString(), assets: { WETH, USDC }, wethUsdc: WETH.usd / USDC.usd,
  };
}

async function rpcCall(address: string, data: string): Promise<string> {
  const response = await fetch(CHAINLINK_RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call",
      params: [{ to: address, data }, "latest"] }),
    signal: AbortSignal.timeout(6000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`Ethereum RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (!body.result) throw new Error(body.error?.message ?? "Ethereum RPC returned no result");
  return body.result;
}

async function fetchChainlink(): Promise<LivePrices> {
  const read = async (address: string, maxAgeSeconds: number) => {
    const [decimalsHex, roundHex] = await Promise.all([
      rpcCall(address, "0x313ce567"), // decimals()
      rpcCall(address, "0xfeaf968c"), // latestRoundData()
    ]);
    return parseChainlinkRound(roundHex, Number(BigInt(decimalsHex)), maxAgeSeconds);
  };
  const [WETH, USDC] = await Promise.all([
    read(CHAINLINK_FEEDS.WETH, 90 * 60),
    read(CHAINLINK_FEEDS.USDC, 27 * 60 * 60),
  ]);
  return {
    source: "Chainlink", network: "Ethereum mainnet",
    sourceUrl: "https://data.chain.link/feeds/ethereum/mainnet/eth-usd",
    fetchedAt: new Date().toISOString(), assets: { WETH, USDC }, wethUsdc: WETH.usd / USDC.usd,
  };
}

let cached: { value: LivePrices; until: number } | undefined;
let inFlight: Promise<LivePrices> | undefined;

export async function getLivePrices(): Promise<LivePrices> {
  if (cached && Date.now() < cached.until) return cached.value;
  if (!inFlight) inFlight = (async () => {
    const key = process.env.PYTH_API_KEY?.trim();
    const value = key ? await fetchPyth(key).catch(() => fetchChainlink()) : await fetchChainlink();
    cached = { value, until: Date.now() + 20_000 };
    return value;
  })().finally(() => { inFlight = undefined; });
  return inFlight;
}
