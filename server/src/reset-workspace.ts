// Explicit local maintenance command: bun src/reset-workspace.ts
// Archives app records only. Never sends transactions or changes wallet balances.
import { openDb, DATABASE_PATH } from "./db";
import { coverageSnapshot } from "./coverage";
import { TEST_POOLS } from "../../frontend/src/lib/test-pools";

const db = openDb();
const tokenIds = (db.query("SELECT token_id FROM market_chain_positions").all() as { token_id: string }[]).map((row) => row.token_id);
// Abort without archiving anything if any chain snapshot cannot be read.
const snapshots = await Promise.all(TEST_POOLS.map((pool) => coverageSnapshot(tokenIds, true, pool.poolId)));
const now = new Date().toISOString();
const backup = DATABASE_PATH.replace(/\.sqlite$/, `-before-bids-${Date.now()}.sqlite`);
db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
db.transaction(() => {
  db.prepare("INSERT OR IGNORE INTO market_archives SELECT id, ? FROM market_drafts").run(now);
  const archive = db.prepare("INSERT OR IGNORE INTO workspace_archives (kind, item_id, archived_at) VALUES (?, ?, ?)");
  for (const id of tokenIds) archive.run("position", id, now);
  for (const snapshot of snapshots) {
    for (const offer of snapshot.offers) archive.run("offer", offer.address.toLowerCase(), now);
    for (const request of snapshot.requests) archive.run("request", request.id, now);
    for (const position of snapshot.positions) archive.run("position", position.tokenId, now);
  }
})();
console.log(JSON.stringify({ backup, archived: db.query("SELECT kind, count(*) AS count FROM workspace_archives GROUP BY kind").all(), markets: db.query("SELECT count(*) AS count FROM market_archives").get() }));
db.close();
