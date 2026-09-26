const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function allowed(path: string[], method: string): boolean {
  if (path.length === 1 && path[0] === "markets") return method === "GET" || method === "POST";
  if (path.length === 1 && path[0] === "portfolio") return method === "GET";
  if (path.length === 1 && path[0] === "underwriting") return method === "GET";
  if (path[0] !== "markets" || !uuid.test(path[1] ?? "")) return false;
  if (path.length === 2) return method === "GET";
  if (path.length === 3 && path[2] === "quote") return method === "GET";
  if (path.length === 3 && path[2] === "price-history") return method === "GET";
  if (path.length === 3 && path[2] === "price") return method === "PATCH";
  if (path.length === 3 && (path[2] === "pledges" || path[2] === "positions")) return method === "POST";
  if (path.length === 5 && path[2] === "positions" && uuid.test(path[3]) && path[4] === "cover") {
    return method === "POST";
  }
  return false;
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!allowed(path, request.method)) {
    return Response.json({ error: "Unknown workspace endpoint" }, { status: 404 });
  }
  const incoming = new URL(request.url);
  const upstream = new URL(`/api/${path.join("/")}`, process.env.NACRE_API_URL ?? "http://127.0.0.1:3001");
  for (const key of ["depositUsd", "participant"]) {
    const value = incoming.searchParams.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers: request.method === "GET" ? undefined : { "content-type": "application/json" },
      body: request.method === "GET" ? undefined : await request.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
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
