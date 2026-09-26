"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Address, type Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { baseClient, basescanTx, ensureBaseSepolia, erc20Abi, injectedClient } from "@/lib/nacre-chain";
import { REPLAY_INVESTOR, REPLAY_UNDERWRITER, REPLAY_TOKEN, SCENARIO_HASH,
  replayAbi, replayBytecode, replayDeployment } from "@/lib/illustrative-settlement";

const STORAGE = "nacre:testnet-illustrative-settlement:v1";
type Saved = { address: Address; deploymentHash: Hex };
type Snapshot = { address: Address; stage: number; premium: bigint; payout: bigint; premiumHash?: Hex; settlementHash?: Hex };
const same = (a: string | null | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
const amount = (value: bigint) => formatUnits(value, 6);

export function TestnetSettlementDemo({ account, role }: { account: string | null; role: "lp" | "underwriter" }) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lastHash, setLastHash] = useState<Hex | null>(null);
  const lock = useRef(false);
  useEffect(() => {
    const load = () => {
      try {
        const raw = localStorage.getItem(STORAGE);
        const value = raw ? JSON.parse(raw) as Saved : null;
        if (value && (!/^0x[0-9a-f]{40}$/i.test(value.address) || !/^0x[0-9a-f]{64}$/i.test(value.deploymentHash))) return;
        setSaved(value);
      } catch { setError("Could not read the saved demo deployment."); }
    };
    load(); window.addEventListener("storage", load);
    return () => window.removeEventListener("storage", load);
  }, []);
  const verify = useCallback(async (entry: Saved) => {
    const [receipt, tx] = await Promise.all([
      baseClient.getTransactionReceipt({ hash: entry.deploymentHash }), baseClient.getTransaction({ hash: entry.deploymentHash }),
    ]);
    if (receipt.status !== "success" || !same(receipt.contractAddress, entry.address)
      || !same(tx.from, REPLAY_UNDERWRITER) || tx.input.toLowerCase() !== replayDeployment().toLowerCase()) {
      throw new Error("This address is not the expected demo deployed by your underwriter wallet.");
    }
  }, []);
  const refresh = useCallback(async (entry: Saved) => {
    await verify(entry);
    const contract = { address: entry.address, abi: replayAbi };
    const [stage, premium, payout, purchaseBlock, settlementBlock] = await Promise.all([
      baseClient.readContract({ ...contract, functionName: "stage" }),
      baseClient.readContract({ ...contract, functionName: "premium" }),
      baseClient.readContract({ ...contract, functionName: "payout" }),
      baseClient.readContract({ ...contract, functionName: "purchaseBlock" }),
      baseClient.readContract({ ...contract, functionName: "settlementBlock" }),
    ]);
    const [purchases, settlements] = await Promise.all([
      purchaseBlock ? baseClient.getContractEvents({ ...contract, eventName: "DemoPremiumPaid", fromBlock: purchaseBlock, toBlock: purchaseBlock }) : [],
      settlementBlock ? baseClient.getContractEvents({ ...contract, eventName: "IllustrativeSettlement", fromBlock: settlementBlock, toBlock: settlementBlock }) : [],
    ]);
    return { address: entry.address, stage, premium, payout,
      premiumHash: purchases[0]?.transactionHash, settlementHash: settlements[0]?.transactionHash };
  }, [verify]);
  useEffect(() => {
    if (!saved) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const snapshot = await refresh(saved); if (active) { setData(snapshot); setError(""); } }
      catch (reason) { if (active) setError(reason instanceof Error ? reason.message : "Testnet read failed"); }
      finally { if (active) timer = setTimeout(() => void load(), 8000); }
    };
    void load(); return () => { active = false; clearTimeout(timer); };
  }, [saved, refresh]);
  const mine = same(account, REPLAY_UNDERWRITER) || same(account, REPLAY_INVESTOR);
  if (!mine) return null;
  const confirm = async (hash: Hex) => {
    setLastHash(hash);
    const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
    if (receipt.status !== "success") throw new Error("Demo transaction reverted.");
    return receipt;
  };
  const run = async (operation: "deploy" | "fund" | "purchase" | "settle" | "cancel") => {
    if (lock.current) return;
    lock.current = true; setError(""); setBusy("Check your wallet…");
    try {
      await ensureBaseSepolia();
      const wallet = injectedClient(); const [owner] = await wallet.getAddresses();
      if (!same(account, owner)) throw new Error("Connected wallet changed. Refresh before continuing.");
      if (operation === "deploy") {
        if (!same(owner, REPLAY_UNDERWRITER)) throw new Error("Use the underwriter wallet to deploy.");
        setBusy("Deploy the labeled demo contract…");
        const hash = await wallet.deployContract({ account: owner, abi: replayAbi, bytecode: replayBytecode,
          args: [REPLAY_TOKEN, REPLAY_INVESTOR, SCENARIO_HASH] });
        const receipt = await confirm(hash);
        if (!receipt.contractAddress) throw new Error("Deployment address missing.");
        const entry = { address: receipt.contractAddress, deploymentHash: hash };
        localStorage.setItem(STORAGE, JSON.stringify(entry)); setSaved(entry);
        return;
      }
      if (!saved) throw new Error("Deploy the demo first.");
      await verify(saved);
      if (operation === "fund" || operation === "purchase") {
        const expected = operation === "fund" ? REPLAY_UNDERWRITER : REPLAY_INVESTOR;
        if (!same(owner, expected)) throw new Error(`Switch to ${expected} for this step.`);
        const value = operation === "fund" ? 10_000_000n : 1_800_000n;
        const [balance, allowance] = await Promise.all([
          baseClient.readContract({ address: REPLAY_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
          baseClient.readContract({ address: REPLAY_TOKEN, abi: erc20Abi, functionName: "allowance", args: [owner, saved.address] }),
        ]);
        if (balance < value) throw new Error(`This step needs ${amount(value)} nUSDC.`);
        if (allowance < value) {
          setBusy(`Approve ${amount(value)} nUSDC for the separate demo…`);
          await confirm(await wallet.writeContract({ account: owner, address: REPLAY_TOKEN, abi: erc20Abi,
            functionName: "approve", args: [saved.address, value] }));
        }
      }
      setBusy(operation === "settle" ? "Publish scenario and pay 1.40 nUSDC…" : `Confirm ${operation} in your wallet…`);
      const { request } = await baseClient.simulateContract({ account: owner, address: saved.address, abi: replayAbi, functionName: operation });
      await confirm(await wallet.writeContract(request));
      setData(await refresh(saved));
    } catch (reason) {
      setError((reason as { shortMessage?: string }).shortMessage ?? (reason instanceof Error ? reason.message : "Demo failed"));
    } finally { lock.current = false; setBusy(""); }
  };
  const current = data?.address === saved?.address ? data : null;
  const paid = current?.stage === 3;
  const bought = current?.stage === 2 || paid;
  const underwriterView = role === "underwriter";
  return <Card className="kd-card mw-panel">
    <div className="kd-card-heading"><h2>Illustrative payout demo</h2><span>REAL BASE SEPOLIA TRANSFERS · SYNTHETIC FEES</span></div>
    <div className="mw-trade-inner">
      <p>This separate demo publishes a chosen 8.60 fee figure and pays a 1.40 shortfall. It does not settle your LP policy or turn simulated fees into trading income.</p>
      <p><strong>Separate demo funding:</strong> the underwriter deposits 10 nUSDC, and the investor pays an additional 1.80 nUSDC premium. At settlement the investor receives 1.40 and the underwriter receives 8.60 back.</p>
      <p>Underwriter: <code>{REPLAY_UNDERWRITER}</code><br />Investor: <code>{REPLAY_INVESTOR}</code></p>
      {current && <div className="mw-stats" aria-live="polite">
        <div className="mw-stat"><span>{underwriterView ? "ACTUAL PREMIUM RECEIVED" : "ACTUAL PREMIUM PAID"}</span><strong>{error ? "—" : bought ? amount(current.premium) : "0"}</strong><small>nUSDC · confirmed on chain</small></div>
        <div className="mw-stat"><span>{underwriterView ? "ACTUAL SHORTFALL PAID" : "ACTUAL SHORTFALL RECEIVED"}</span><strong>{error ? "—" : paid ? amount(current.payout) : "0"}</strong><small>nUSDC · confirmed on chain</small></div>
        <div className="mw-stat"><span>{underwriterView ? "DEMO NET RESULT" : "SCENARIO FEES · SIMULATED"}</span><strong>{underwriterView ? error || !paid ? "—" : amount(current.premium-current.payout) : "8.60"}</strong><small>{underwriterView ? "nUSDC · before gas" : "Not actual trading income"}</small></div>
      </div>}
      <p><a href="/illustrative-scenario.json" target="_blank" rel="noreferrer">View the disclosed synthetic input</a></p>
      {saved && <p><a href={basescanTx(saved.deploymentHash)} target="_blank" rel="noreferrer">Deployment on BaseScan</a> · <a href={`https://sepolia.basescan.org/address/${saved.address}`} target="_blank" rel="noreferrer">Demo contract</a></p>}
      {current?.premiumHash && <p><a href={basescanTx(current.premiumHash)} target="_blank" rel="noreferrer">Premium payment on BaseScan</a></p>}
      {current?.settlementHash && <p><a href={basescanTx(current.settlementHash)} target="_blank" rel="noreferrer">1.40 payout and 8.60 collateral return on BaseScan</a></p>}
      {!saved && <Button disabled={!!busy || !same(account, REPLAY_UNDERWRITER)} onClick={() => void run("deploy")}>1. Deploy demo with underwriter wallet</Button>}
      {current?.stage === 0 && <Button disabled={!!busy || !same(account, REPLAY_UNDERWRITER)} onClick={() => void run("fund")}>2. Fund demo with 10 nUSDC</Button>}
      {current?.stage === 1 && <Button disabled={!!busy || !same(account, REPLAY_INVESTOR)} onClick={() => void run("purchase")}>3. Pay separate demo premium · 1.80 nUSDC</Button>}
      {current?.stage === 2 && <Button disabled={!!busy} onClick={() => void run("settle")}>4. Publish scenario & pay 1.40 nUSDC</Button>}
      {current && current.stage < 2 && same(account, REPLAY_UNDERWRITER) && <Button variant="outline" disabled={!!busy} onClick={() => void run("cancel")}>Cancel demo and recover funding</Button>}
      {paid && <p role="status">Demo settled. Investor received 1.40 nUSDC; underwriter earned 0.40 net before gas. The investor paid 0.40 more in premium than they received in this example.</p>}
      {current?.stage === 4 && <p role="status">Demo cancelled. Funding returned.</p>}
      {busy && <p role="status">{busy}</p>}{error && <p role="alert" className="mw-premium-warning">{error}</p>}
      {lastHash && <p><a href={basescanTx(lastHash)} target="_blank" rel="noreferrer">Latest submitted transaction</a></p>}
    </div>
  </Card>;
}
