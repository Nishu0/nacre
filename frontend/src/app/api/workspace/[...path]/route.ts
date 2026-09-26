const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowed(path: string[], method: string): boolean {
  if (path.length === 1 && path[0] === "open-pools") return method === "POST";
  if (path.length === 1 && path[0] === "bid-markets") return method === "GET";
  if (path.length === 1 && path[0] === "bid-market") return method === "GET";
  if (path.length === 1 && path[0] === "coverage") return method === "GET";
  if (path.length === 1 && path[0] === "markets") return method === "GET" || method === "POST";
  if (path.length === 1 && path[0] === "chain-positions") return method === "GET";
  if (path.length === 1 && path[0] === "live-prices") return method === "GET";
  if (path.length === 1 && path[0] === "live-price-history") return method === "GET";
  if (path[0] !== "markets" || !uuid.test(path[1] ?? "")) return false;
  if (path.length === 2) return method === "GET";
  if (path.length === 3 && path[2] === "quote") return method === "GET";
  if (path.length === 3 && path[2] === "fee-request") return method === "GET";
  if (path.length === 3 && path[2] === "risk") return method === "GET";
  if (path.length === 3 && path[2] === "price-history") return method === "GET";
  if (path.length === 3 && path[2] === "chain-positions") return method === "POST";
  return false;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowed(path, request.method)) {
    return Response.json({ error: "Unknown workspace endpoint" }, { status: 404 });
  }
  const incoming = new URL(request.url);
  const upstream = new URL(`/api/${path.join("/")}`, process.env.NACRE_API_URL ?? "http://127.0.0.1:3001");
  for (const key of ["fresh", "poolId", "depositUsd", "participant", "account", "marketId", "lowerPriceUsd", "upperPriceUsd", "days", "feeTargetUsd"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers: request.method === "GET" ? undefined : { "content-type": "application/json" },
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(["coverage", "open-pools"].includes(path[0]) ? 20000 : 8000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json({ error: "Workspace API unavailable. Start the Bun server." }, { status: 503 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
