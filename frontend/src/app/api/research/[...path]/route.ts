const allowedPoolIds = new Set(["usdc-weth-005", "wbtc-weth-005", "usdc-usdt-001"]);

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const isPoolList = path.length === 1 && path[0] === "pools";
  const isPoolResearch = path.length === 3 && path[0] === "pools"
    && allowedPoolIds.has(path[1]) && (path[2] === "backtest" || path[2] === "quotes");
  if (!isPoolList && !isPoolResearch) {
    return Response.json({ error: "Unknown research endpoint" }, { status: 404 });
  }

  const incoming = new URL(request.url);
  const upstream = new URL(`/api/${path.join("/")}`, process.env.NACRE_API_URL ?? "http://127.0.0.1:3001");
  if (isPoolResearch && incoming.searchParams.has("principalUsd")) {
    upstream.searchParams.set("principalUsd", incoming.searchParams.get("principalUsd")!);
  }

  try {
    const response = await fetch(upstream, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  } catch {
    return Response.json(
      { error: "Research API unavailable. Start the Bun server and try again." },
      { status: 503 },
    );
  }
}
