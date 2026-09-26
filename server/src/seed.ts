import { readFileSync } from "node:fs";
import { openDb, seedDb } from "./db";
import type { Snapshot } from "./market-data";

const snapshot = JSON.parse(
  readFileSync(new URL("../data/pool-history.json", import.meta.url), "utf8"),
) as Snapshot;
const db = openDb();
seedDb(db, snapshot);
db.close();
console.log(`Seeded ${snapshot.pools.length} pools through ${snapshot.through}`);
