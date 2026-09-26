import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const runtime = "nodejs";

// Production needs an explicit opt-in and a read-only demo artifact mount.
export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (process.env.NODE_ENV !== "development" && process.env.NACRE_DEMO !== "1") {
    return Response.json({ enabled: false }, { headers });
  }
  const directory = process.env.NACRE_DEMO_DIR ?? resolve(process.cwd(), "../.deploy/thirty-day-simulation");
  try {
    const state = JSON.parse(await readFile(`${directory}/dashboard.json`, "utf8"));
    if (!state.enabled) return Response.json({ enabled: false }, { headers });
    const query = new URL(request.url).searchParams;
    const hash = query.get("tx");
    if (hash) {
      if (state.status !== "settled" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
        return Response.json({ error: "No verified demo transaction" }, { status: 404, headers });
      }
      const report = JSON.parse(await readFile(`${directory}/receipts.json`, "utf8"));
      if (report.settlementHash !== state.settlementHash) throw new Error("Demo run mismatch");
      const transaction = report.transactions.find((tx: { hash: string }) => tx.hash.toLowerCase() === hash.toLowerCase());
      if (!transaction) return Response.json({ error: "Unknown demo transaction" }, { status: 404, headers });
      return new Response(JSON.stringify({ simulation: true, network: "Local Anvil", chainId: 31337,
        notice: "Saved local receipt. This is not a Base Sepolia transaction.",
        verifiedAt: state.verifiedAt, totals: report.totals, addresses: report.addresses,
        settlementTransfers: hash.toLowerCase() === report.settlementHash.toLowerCase() ? report.transfers : undefined,
        transaction }, null, 2), { headers: { ...headers, "content-type": "application/json" } });
    }
    if (query.has("report") && state.status === "settled") {
      const html = (await readFile(`${directory}/report.html`, "utf8"))
        .replace('href="receipts.json"', 'href="?download=receipts"').replace('href="daily.csv"', 'href="?download=daily"');
      return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
    }
    const download = query.get("download");
    if (download && state.status === "settled") {
      const file = download === "receipts" ? "receipts.json" : download === "daily" ? "daily.csv" : null;
      if (!file) return Response.json({ error: "Unknown artifact" }, { status: 404, headers });
      return new Response(await readFile(`${directory}/${file}`, "utf8"), { headers: {
        ...headers, "content-type": file.endsWith("json") ? "application/json" : "text/csv",
        "content-disposition": `attachment; filename="${file}"`,
      } });
    }
    return Response.json(state, { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ enabled: false }, { headers });
    return Response.json({ error: "Demo results could not be loaded" }, { status: 503, headers });
  }
}
