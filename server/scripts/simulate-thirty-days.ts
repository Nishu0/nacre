/** Local EVM demo. Never reads deployment keys or connects to a public chain. */
import { createPublicClient, createWalletClient, http, getContractAddress, encodeAbiParameters,
  parseAbiParameters, parseEventLogs, formatUnits, parseUnits, type Address, type Hex } from "viem";
import { anvil as chain } from "viem/chains";
import { createServer } from "node:net";
import { mkdir, rename } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const output = resolve(root, ".deploy/thirty-day-simulation");
// Opt in per run. This writes only a clearly labeled local dashboard snapshot.
const dashboardDemo = process.env.NACRE_DEMO === "1";
async function publishDashboard(value: object) {
  await mkdir(output, { recursive: true });
  const temporary = `${output}/dashboard.${process.pid}.tmp`;
  await Bun.write(temporary, JSON.stringify(value));
  await rename(temporary, `${output}/dashboard.json`);
}
if (process.argv.includes("--hide-demo")) {
  await publishDashboard({ enabled: false });
  console.log("Dashboard simulation hidden. Live portfolio unchanged.");
  process.exit(0);
}
const prices = [2689.5,2700,2720,2710,2690,2650,2620,2670,2740,2800,2890,3010,3075,2990,2910,2840,2780,2710,2660,2610,2540,2490,2520,2580,2640,2700,2730,2690,2670,2689.5];
const lowerTick = -198410, upperTick = -196400;
const lower = 1.0001 ** lowerTick * 1e12, upper = 1.0001 ** upperTick * 1e12;
const floor = parseUnits(process.env.DEMO_FEE_CAP ?? "10", 6), cap = floor;
const premium = parseUnits(process.env.DEMO_PREMIUM ?? "1.8", 6);
const desiredPayout = parseUnits(process.env.DEMO_PAYOUT ?? "1.4", 6);
if (floor <= 0n || premium <= 0n || premium > cap || desiredPayout <= 0n || desiredPayout >= cap) throw new Error("Invalid demo terms");
const targetFees = floor - desiredPayout;
// Round typical daily fees to cents; the final in-range day reconciles exactly.
const dailyFee = ((targetFees / 27n + 5_000n) / 10_000n) * 10_000n;
const finalDayFee = targetFees - dailyFee * 26n;
if (finalDayFee < 0n) throw new Error("Demo fee target too small for daily cent rounding");

if (dashboardDemo) await publishDashboard({ enabled: true, status: "running" });
const build = Bun.spawn(["forge", "build", "test/demo/ThirtyDayMocks.sol", "-q"], { cwd: `${root}/contract`, stdout: "inherit", stderr: "inherit" });
if (await build.exited) {
  if (dashboardDemo) await publishDashboard({ enabled: true, status: "failed" });
  throw new Error("Contract build failed");
}
const listener = createServer();
await new Promise<void>((done) => listener.listen(0, "127.0.0.1", done));
const port = (listener.address() as { port: number }).port;
await new Promise<void>((done) => listener.close(() => done()));
const rpc = `http://127.0.0.1:${port}`;
const node = Bun.spawn(["anvil", "--host", "127.0.0.1", "--port", String(port), "--chain-id", "31337", "--silent"], { stdout: "ignore", stderr: "inherit" });
const client = createPublicClient({ chain, transport: http(rpc), pollingInterval: 20 });
const wallet = createWalletClient({ chain, transport: http(rpc) });
const artifacts = new Map<string, any>();
async function artifact(file: string, name = file) {
  const key = `${file}/${name}`;
  if (!artifacts.has(key)) artifacts.set(key, await Bun.file(`${root}/contract/out/${file}.sol/${name}.json`).json());
  return artifacts.get(key);
}
const transactions: any[] = [];
let day = 0;
async function record(hash: Hex, label: string) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  transactions.push({ day, label, hash, receipt });
  return receipt;
}
async function deploy(file: string, name: string, args: any[], account: Address) {
  const a = await artifact(file, name);
  const hash = await wallet.deployContract({ account, abi: a.abi, bytecode: a.bytecode.object, args });
  const receipt = await record(hash, `Deploy ${name}`);
  return { address: receipt.contractAddress!, abi: a.abi };
}
async function send(c: any, fn: string, args: any[], account: Address, label = fn) {
  const { request } = await client.simulateContract({ ...c, functionName: fn, args, account });
  return record(await wallet.writeContract(request), label);
}
async function read(c: any, fn: string, args: any[] = []): Promise<any> {
  return client.readContract({ ...c, functionName: fn, args });
}
const money = (n: bigint) => formatUnits(n, 6);
const check = (ok: boolean, label: string) => { if (!ok) throw new Error(`Assertion failed: ${label}`); };
const daily: any[] = [];
let settlementPublishedLocally = false;

try {
  for (let attempt = 0; ; attempt++) {
    try { await client.getChainId(); break; } catch { if (attempt >= 50) throw new Error("Local Anvil did not start"); await Bun.sleep(100); }
  }
  check(await client.getChainId() === 31337, "local chain only");
  const [operator, investor, underwriter] = await wallet.getAddresses();
  const usdc = await deploy("ThirtyDayMocks", "DemoToken", ["Demo USD", "dUSDC", 6], operator);
  const weth = await deploy("ThirtyDayMocks", "DemoToken", ["Demo ETH", "dWETH", 18], operator);
  const manager = await deploy("ThirtyDayMocks", "DemoPoolManager", [], operator);
  const nonce = await client.getTransactionCount({ address: operator });
  const predictedPositions = getContractAddress({ from: operator, nonce: BigInt(nonce + 1) });
  const hook = await deploy("NacreFeeHook", "NacreFeeHook", [manager.address, predictedPositions, operator], operator);
  const positions = await deploy("ThirtyDayMocks", "DemoPositionManager", [manager.address, hook.address], operator);
  check(positions.address.toLowerCase() === predictedPositions.toLowerCase(), "hook position manager binding");
  const oracle = await deploy("ThirtyDayMocks", "DemoFeeOracle", [usdc.address, weth.address], operator);
  const aqua = await deploy("Aqua", "Aqua", [], operator);
  const vault = await deploy("NacrePolicyVault", "NacrePolicyVault", [usdc.address, positions.address, oracle.address, hook.address], operator);
  const app = await deploy("NacreAquaUnderwriter", "NacreAquaUnderwriter", [aqua.address, vault.address], operator);
  await send(hook, "setController", [vault.address], operator);
  await send(vault, "setAquaApp", [app.address], operator);
  const key = { currency0: weth.address, currency1: usdc.address, fee: 10000, tickSpacing: 10, hooks: hook.address };
  await send(manager, "setTick", [Math.floor(Math.log(prices[0] / 1e12) / Math.log(1.0001))], operator);
  await send(positions, "mint", [investor, 1n, key], operator, "Create demo LP NFT (mock liquidity)");
  await send(usdc, "mint", [investor, 100_000_000n], operator);
  await send(usdc, "mint", [underwriter, 100_000_000n], operator);
  await send(positions, "approve", [vault.address, 1n], investor);
  const deadline = (await client.getBlock()).timestamp + 86400n;
  await send(vault, "createRequest", [key, 1n, floor, cap, 30 * 86400, deadline], investor, "Investor requests 30 day fee protection");
  const quote = { maker: underwriter, requestId: 1n, premium, payoutCap: cap, expiresAt: deadline, salt: `0x${"00".repeat(31)}01` };
  await send(usdc, "approve", [aqua.address, cap], underwriter);
  const encoded = encodeAbiParameters(parseAbiParameters("(address maker,uint256 requestId,uint256 premium,uint256 payoutCap,uint64 expiresAt,bytes32 salt)"), [quote as any]);
  await send(aqua, "ship", [app.address, encoded, [usdc.address], [cap]], underwriter, `Underwriter funds a ${money(cap)} dUSDC quote through Aqua`);
  await send(usdc, "approve", [app.address, premium], investor);
  const purchase = await send(app, "buyCoverage", [quote], investor, `Investor pays ${money(premium)} premium; Aqua locks ${money(cap)} collateral`);
  const started = (await client.getBlock({ blockNumber: purchase.blockNumber })).timestamp;
  let earned = 0n;
  console.log("Day | Price | In range | Daily fees | Total fees | Shortfall if no more fees");
  for (day = 1; day <= 30; day++) {
    // One sample represents the entire day's dummy price and modeled volume.
    await client.request({ method: "evm_setNextBlockTimestamp" as any, params: [Number(started) + day * 86400] as any });
    const price = prices[day - 1];
    const tick = Math.floor(Math.log(price / 1e12) / Math.log(1.0001));
    const tickTx = await send(manager, "setTick", [tick], operator, `Day ${day}: dummy price ${price}`);
    const inRange = tick >= lowerTick && tick < upperTick;
    const fees = inRange ? (day === 30 ? finalDayFee : dailyFee) : 0n;
    const accrual = fees ? await send(positions, "addFees", [1n, 0n, fees], operator, `Day ${day}: accrue ${money(fees)} modeled fees`) : null;
    earned += fees;
    if (day === 14) {
      let premature = false;
      try { await client.simulateContract({ ...vault, functionName: "settle", args: [1n], account: operator }); }
      catch (error) { premature = String(error).includes("TooEarly"); }
      check(premature, "Day 14 settlement must fail with TooEarly");
    }
    const shortfall = earned < floor ? floor - earned : 0n;
    daily.push({ day, price, tick, inRange, fees: money(fees), totalFees: money(earned), provisionalShortfall: money(shortfall), priceTx: tickTx.transactionHash, feeTx: accrual?.transactionHash ?? null });
    console.log(`${day} | ${price} | ${inRange ? "yes" : "NO"} | ${money(fees)} | ${money(earned)} | ${money(shortfall)}`);
  }
  day = 30;
  const lpBefore = await read(usdc, "balanceOf", [investor]);
  const uwBefore = await read(usdc, "balanceOf", [underwriter]);
  const settlement = await send(vault, "settle", [1n], operator, "Day 30: settle; fees and shortfall to investor, unused collateral to underwriter");
  check(earned === targetFees, "modeled fees match chosen demo target");
  const payout = floor > earned ? (floor - earned < cap ? floor - earned : cap) : 0n;
  const refund = cap - payout;
  const logs = parseEventLogs({ abi: vault.abi, logs: settlement.logs, eventName: "Settled" }) as any[];
  check(daily.filter((r) => !r.inRange).length === 3, "exactly three out of range days");
  check(logs.length === 1 && logs[0].args.eligibleFees === earned && logs[0].args.payout === payout, "actual Settled event matches math");
  check(await read(usdc, "balanceOf", [investor]) - lpBefore === earned + payout, "investor received fees plus payout");
  check(await read(usdc, "balanceOf", [underwriter]) - uwBefore === refund, "underwriter received unused collateral");
  check(await read(usdc, "balanceOf", [underwriter]) === 100_000_000n + premium - payout, "underwriter net accounting");
  check((await read(positions, "ownerOf", [1n])).toLowerCase() === investor.toLowerCase(), "NFT returned to investor");
  check(await read(vault, "reservedCollateral") === 0n, "no collateral left reserved");
  const transfers = (parseEventLogs({ abi: usdc.abi, logs: settlement.logs.filter((log) => log.address.toLowerCase() === usdc.address.toLowerCase()), eventName: "Transfer" }) as any[])
    .map((log) => ({ from: log.args.from, to: log.args.to, amount: money(log.args.value), logIndex: log.logIndex }));
  const result = { simulation: true, chainId: 31337, assumptions: `Dummy daily prices; ${money(dailyFee)} dUSDC fees per in-range day and ${money(finalDayFee)} on the final day; mock LP NFT, tokens, pool and fee oracle. Real Nacre vault, fee hook, Aqua app and Aqua execute purchase and settlement. No real AMM swaps, LP principal simulation or public-chain transfers.`,
    addresses: { investor, underwriter, vault: vault.address, aqua: aqua.address, token: usdc.address }, range: { lower, upper, lowerTick, upperTick },
    totals: { feeTarget: money(floor), cap: money(cap), premium: money(premium), earned: money(earned), payout: money(payout), underwriterRefund: money(refund), investorFeesAfterPremium: money(earned + payout - premium), underwriterNet: money(premium - payout) },
    purchaseHash: purchase.transactionHash, settlementHash: settlement.transactionHash, transfers, daily, transactions };
  await mkdir(output, { recursive: true });
  const json = JSON.stringify(result, (_, value) => typeof value === "bigint" ? value.toString() : value, 2);
  await Bun.write(`${output}/receipts.json`, json);
  await Bun.write(`${output}/daily.csv`, "day,price,inRange,dailyFees,totalFees,provisionalShortfall,priceTx,feeTx\n" + daily.map((r) => [r.day,r.price,r.inRange,r.fees,r.totalFees,r.provisionalShortfall,r.priceTx,r.feeTx ?? ""].join(",")).join("\n"));
  const rows = daily.map((r) => `<tr class="${r.inRange ? "" : "out"}"><td>${r.day}</td><td>$${r.price.toFixed(2)}</td><td>${r.inRange ? "In range" : "Outside range"}</td><td>${r.fees}</td><td>${r.totalFees}</td><td>${r.provisionalShortfall}</td></tr>`).join("");
  const x = (i: number) => 65 + i * 29;
  const y = (price: number) => 220 - (price - 2350) / 800 * 190;
  const chart = `<svg viewBox="0 0 980 260" role="img" aria-label="Dummy prices across 30 days. Days 12 through 14 exceed the funded upper boundary." style="width:100%"><rect x="65" y="${y(upper)}" width="841" height="${y(lower) - y(upper)}" fill="#e3efe5"/><text x="65" y="${y(upper)-8}" font-size="12" fill="#386749">Upper boundary $${upper.toFixed(2)}</text><text x="65" y="${y(lower)+18}" font-size="12" fill="#386749">Lower boundary $${lower.toFixed(2)}</text><polyline points="${prices.map((p,i)=>`${x(i)},${y(p)}`).join(" ")}" fill="none" stroke="#386749" stroke-width="3"/>${daily.filter(r=>!r.inRange).map(r=>`<circle cx="${x(r.day-1)}" cy="${y(r.price)}" r="5" fill="#be5429"/>`).join("")}<text x="65" y="252" font-size="12">Day 1</text><text x="870" y="252" font-size="12">Day 30</text></svg>`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nacre · 30 day settlement demo</title><style>
  body{font:16px/1.6 system-ui;background:#f5f8f4;color:#213e2b;margin:0;padding:32px}main{max-width:1080px;margin:auto}h1{font-size:42px;line-height:1.15}h2{margin-top:36px}.label{letter-spacing:.15em;font-size:12px}section,.metrics{padding:24px;background:white;border:1px solid #cddbd0;border-radius:16px;margin:20px 0}.metrics{display:flex;gap:32px;flex-wrap:wrap}.metrics strong{display:block;font-size:28px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e4ebe5}.out{background:#fff0e6;color:#8b3919}code{overflow-wrap:anywhere;font-size:13px}.scroll{overflow:auto}.note{color:#566a5c}a{color:#276640}</style><main>
  <p class="label">NACRE · LOCAL SIMULATION · CHAIN 31337</p><h1>Three quiet days.<br>A ${money(payout)} dUSDC shortfall paid.</h1><p>30 day policy · Range $${lower.toFixed(2)} to $${upper.toFixed(2)} · Days 12, 13 and 14 outside the range.</p>
  <div class="metrics"><div>Trading fees<strong>${money(earned)}</strong></div><div>Investor payout<strong>${money(payout)}</strong></div><div>Premium paid<strong>${money(premium)}</strong></div><div>Underwriter net<strong>${money(premium - payout)}</strong></div></div>
  <section><h2>What this demonstrates</h2><p>${result.assumptions}</p><p>All amounts are dummy USDC. Hashes below are actual receipts from this isolated local run, not BaseScan transactions. Your live position #28556 is untouched.</p></section>
  <section><h2>Day 0 · Pay premium and reserve cover</h2><p>Investor pays ${money(premium)} to the underwriter. Aqua transfers ${money(cap)} from the underwriter into the policy vault. Of 100 starting capital, the underwriter now holds ${money(100_000_000n - cap + premium)} and has ${money(cap)} reserved.</p><code>${purchase.transactionHash}</code></section>
  <section><h2>The daily math</h2>${chart}<p>Assume modeled volume produces ${money(dailyFee)} per whole day in range, with ${money(finalDayFee)} on day 30. Outside the range, fees are zero. The last column is the remaining target if no further fees arrive. It is not an accrued claim or daily payment.</p><div class="scroll"><table><thead><tr><th>Day</th><th>Dummy price</th><th>Range</th><th>Daily fees</th><th>Total fees</th><th>Remaining target</th></tr></thead><tbody>${rows}</tbody></table></div><p>Day 14 settlement was checked and correctly rejected with TooEarly. Payout requires expiry and measured fee shortfall; time outside the range alone does not trigger payment.</p><p>Without the three outside days, this price/volume scenario would earn ${money(earned + 3n*dailyFee)}. Those days remove ${money(3n*dailyFee)} of modeled fees. The contract uses the final measured shortfall, not the number of outside days.</p></section>
  <section><h2>Day 30 · One settlement transaction</h2><p>Fees = 26 × ${money(dailyFee)} + ${money(finalDayFee)} = <strong>${money(earned)}</strong><br>Shortfall = max(${money(floor)} − ${money(earned)}, 0) = <strong>${money(payout)}</strong><br>Payout = min(shortfall, ${money(cap)} cap) = <strong>${money(payout)}</strong><br>Unused collateral returned = ${money(cap)} − ${money(payout)} = <strong>${money(refund)}</strong></p><p>The vault pays from collateral already reserved by the underwriter. There is no separate underwriter signature or second claim payment transaction.</p><code>${settlement.transactionHash}</code><div class="scroll"><table><thead><tr><th>From</th><th>To</th><th>dUSDC</th></tr></thead><tbody>${transfers.map((t) => `<tr><td><code>${t.from}</code></td><td><code>${t.to}</code></td><td>${t.amount}</td></tr>`).join("")}</tbody></table></div></section>
  <section><h2>Final result, before gas</h2><p>Investor: ${money(earned)} fees + ${money(payout)} payout − ${money(premium)} premium = <strong>${money(earned+payout-premium)} net fee income</strong>, plus the returned LP NFT. LP principal and impermanent loss are not modeled or insured here.</p><p>Underwriter: ${money(premium)} premium − ${money(payout)} payout = <strong>${money(premium-payout)} net result</strong>. Their final token balance is <strong>${money(100_000_000n+premium-payout)}</strong> from an initial 100. This is a chosen demonstration scenario, not a prediction or guarantee. The investor pays ${money(premium-payout)} more in premium than they recover in this scenario; the purchase provides protection against larger eligible shortfalls.</p><p>Assertions passed for the Settled event, both token balances, NFT return, three outside days, early settlement rejection and zero remaining reserved collateral.</p><a href="receipts.json">Full local receipts</a> · <a href="daily.csv">Daily CSV</a></section></main></html>`;
  await Bun.write(`${output}/report.html`, html);
  if (dashboardDemo) {
    await publishDashboard({ enabled: true, status: "settled", verifiedAt: new Date().toISOString(),
      chainId: 31337, totals: result.totals, settlementHash: result.settlementHash,
      purchaseHash: result.purchaseHash, addresses: result.addresses, transfers });
    settlementPublishedLocally = true;
    console.log(`Dashboard: http://localhost:3000/dashboard/simulation\nSettlement receipt: http://localhost:3000/api/demo-settlement?tx=${settlement.transactionHash}`);
    if (process.env.NACRE_DEMO_PUBLISH === "1") {
      const publish = Bun.spawn(["bun", `${import.meta.dir}/publish-demo.ts`], { stdout: "inherit", stderr: "inherit" });
      if (await publish.exited) throw new Error("Settlement succeeded locally but publishing failed; rerun publish-demo.ts");
    }
  }
  console.log(`\nPASS: payout ${money(payout)}; investor net ${money(earned + payout - premium)}; underwriter net ${money(premium - payout)}.\nSettlement: ${settlement.transactionHash}\nReport: ${output}/report.html`);
} catch (error) {
  if (dashboardDemo && !settlementPublishedLocally) await publishDashboard({ enabled: true, status: "failed" });
  throw error;
} finally {
  node.kill();
  await node.exited;
}
