import type { Database } from "bun:sqlite";
import type { CoverageSnapshot } from "../../frontend/src/lib/coverage-contracts";

export function activeCoverage(db: Database, snapshot: CoverageSnapshot): CoverageSnapshot {
  const rows = db.query("SELECT kind, item_id FROM workspace_archives").all() as { kind: string; item_id: string }[];
  const archived = new Set(rows.map((row) => `${row.kind}:${row.item_id.toLowerCase()}`));
  const requests = snapshot.requests.filter((row) => !archived.has(`request:${row.id}`));
  return { ...snapshot,
    offers: snapshot.offers.filter((row) => !archived.has(`offer:${row.address.toLowerCase()}`)),
    positions: snapshot.positions.filter((row) => !archived.has(`position:${row.tokenId}`)),
    requests,
    reserved: requests.filter((row) => row.status === 2).reduce((sum, row) => sum + BigInt(row.payoutCap), 0n).toString(),
  };
}
