/** Publish saved, labeled simulation artifacts to the existing demo host. No signing keys. */
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "../..");
const directory = resolve(root, ".deploy/thirty-day-simulation");
const state = await Bun.file(`${directory}/dashboard.json`).json();
if (state.enabled && state.status !== "settled") throw new Error("Only a verified settled demo or a hidden demo can be published");
const target = "ubuntu@3.108.133.250";
const ssh = ["-i", `${root}/nacre.pem`, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10"];
async function run(command: string[]) {
  const result = Bun.spawn(command, { stdout: "inherit", stderr: "inherit" });
  if (await result.exited) throw new Error(`Demo publish failed: ${command[0]}`);
}
// The deployment creates this directory with ubuntu ownership. Rename the state
// last so polling clients only observe the completed published result.
await run(["ssh", ...ssh, target, "test -d /opt/nacre/deploy/demo"]);
if (state.enabled) {
  const receipts = await Bun.file(`${directory}/receipts.json`).json();
  if (receipts.settlementHash !== state.settlementHash) throw new Error("Snapshot and receipts do not match");
  await run(["scp", ...ssh, `${directory}/receipts.json`, `${directory}/report.html`, `${directory}/daily.csv`, `${target}:/opt/nacre/deploy/demo/`]);
}
await run(["scp", ...ssh, `${directory}/dashboard.json`, `${target}:/opt/nacre/deploy/demo/dashboard.next.json`]);
await run(["ssh", ...ssh, target, "mv /opt/nacre/deploy/demo/dashboard.next.json /opt/nacre/deploy/demo/dashboard.json"]);
console.log(state.enabled
  ? `Published demo: https://nacre.lol/dashboard/simulation\nReceipt: https://nacre.lol/api/demo-settlement?tx=${state.settlementHash}`
  : "Demo panel hidden on nacre.lol");
