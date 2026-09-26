"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Hex } from "viem";
import { openPoolAbi, openPoolBytecode, openPoolDeploymentData, openPoolId, startingSqrtPrice, OPEN_POOL_FEES } from "@/lib/open-pool";
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, CircleHelp, Database, Droplets, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { Input } from "@/components/ui/input";
import { baseClient, injectedClient, ensureBaseSepolia, basescanTx, NACRE_TEST_USDC, NACRE_HOOK, UNISWAP_STATE_VIEW, stateViewAbi, sqrtPriceX96ToWethUsd } from "@/lib/nacre-chain";
import { NACRE_TEST_WETH, TEST_WETH_POOL } from "@/lib/test-pools";

const PENDING_KEY = "nacre-pending-pool-creation";
const KEY = "nacre-pool-setup-draft-v1";
const steps = [
  { title: "Pool details", subtitle: "Token pair and network", icon: Droplets },
  { title: "Starting price", subtitle: "Price and pool configuration", icon: Activity },
  { title: "Review & create", subtitle: "Confirm your pool setup", icon: ShieldCheck },
];
const money = (n: number) => Number.isFinite(n) && n > 0 ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

export function PoolCreateFlow({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  const lock = useRef(false);
  const [fee, setFee] = useState(3000);
  const [busy, setBusy] = useState("");
  const [pendingHash, setPendingHash] = useState<Hex | null>(null);
  const [created, setCreated] = useState<{ id: string; hash: Hex } | null>(null);
  const [availability, setAvailability] = useState<{ fee: number; exists: boolean } | null>(null);
  const [poolCheckError, setPoolCheckError] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState("");
  const [issue, setIssue] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const completed = !!created;
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceError, setPriceError] = useState("");
  const price = Number(priceInput);
  const validPrice = priceInput.trim() !== "" && Number.isFinite(price) && price >= .01 && price <= 1_000_000;

  useEffect(() => {
    let storedPrice = "";
    let page = 0;
    let storedFee = 3000;
    let pending: Hex | null = null;
    try {
      const hash = localStorage.getItem(PENDING_KEY);
      if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) pending = hash as Hex;
      const draft = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (draft?.version === 1 && typeof draft.priceUsd === "string") {
        storedPrice = draft.priceUsd;
        if (OPEN_POOL_FEES.includes(draft.fee)) storedFee = draft.fee;
        page = Number.isInteger(draft.step) ? Math.max(0, Math.min(2, draft.step)) : 0;
      }
    } catch { /* Invalid or unavailable storage starts a new draft. */ }
    queueMicrotask(() => { setPriceInput(storedPrice); setFee(storedFee); setPendingHash(pending); setStep(pending ? 2 : page); setReady(true); });
    let active = true;
    void baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [TEST_WETH_POOL] })
      .then(([sqrtPriceX96]) => {
        if (!active) return;
        const value = sqrtPriceX96ToWethUsd(sqrtPriceX96);
        setCurrentPrice(value);
        setPriceInput((previous) => previous || value.toFixed(2));
      }).catch(() => { if (active) setPriceError("Current pool price is unavailable. You can enter a starting price manually."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [openPoolId(fee)] })
      .then(([sqrt]) => { if (active) { setAvailability({ fee, exists: sqrt > 0n }); setPoolCheckError(""); } })
      .catch(() => { if (active) setPoolCheckError("Could not check this pool. Creation will check again before asking you to sign."); });
    return () => { active = false; };
  }, [fee]);
  const exists = availability?.fee === fee && availability.exists;
  async function createPool() {
    if (lock.current) return;
    if (!account && !pendingHash) { await onConnect(); return; }
    lock.current = true; setIssue(""); setBusy("Checking pool…");
    try {
      let hash = pendingHash;
      if (!hash) {
        const sqrt = startingSqrtPrice(priceInput);
        await ensureBaseSepolia();
        const [owner] = await injectedClient().getAddresses();
        if (!owner || owner.toLowerCase() !== account?.toLowerCase()) throw new Error("Wallet changed. Reconnect before creating the pool.");
        const [existing] = await baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [openPoolId(fee)] });
        if (existing > 0n) throw new Error("This token pair and fee tier already has a pool. Choose an unused trading fee tier.");
        const estimate = await baseClient.estimateGas({ account: owner, data: openPoolDeploymentData(fee, sqrt) });
        const gas = estimate * 120n / 100n;
        if (gas > 15_000_000n) throw new Error("Estimated gas exceeds the network transaction limit.");
        setBusy("Confirm pool creation in your wallet…");
        hash = await injectedClient().deployContract({ account: owner, abi: openPoolAbi, bytecode: openPoolBytecode, args: [fee, sqrt], gas });
        setPendingHash(hash);
        try { localStorage.setItem(PENDING_KEY, hash); } catch { /* The transaction remains available in this page's state. */ }
      }
      setBusy("Waiting for pool confirmation…");
      const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      hash = receipt.transactionHash;
      if (receipt.status !== "success" || !receipt.contractAddress) {
        setPendingHash(null);
        try { localStorage.removeItem(PENDING_KEY); } catch { /* Storage may be unavailable. */ }
        throw new Error("Pool creation reverted or was cancelled. Your settings are kept so you can retry.");
      }
      setPendingHash(hash);
      try { localStorage.setItem(PENDING_KEY, hash); } catch { /* Keep the confirmed hash in state if storage is unavailable. */ }
      setBusy("Adding your confirmed pool to the dashboard…");
      const response = await fetch("/api/workspace/open-pools", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ txHash: hash }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Pool created, but registration failed. Retry to register the same transaction.");
      setCreated({ id: result.market.id, hash });
      setPendingHash(null);
      try { localStorage.removeItem(PENDING_KEY); localStorage.removeItem(KEY); } catch { /* Successful creation does not depend on browser storage. */ }
    } catch (reason) {
      setIssue((reason as { shortMessage?: string }).shortMessage ?? (reason instanceof Error ? reason.message : "Pool creation failed."));
    } finally { lock.current = false; setBusy(""); }
  }
  function saveDraft() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, priceUsd: priceInput, step,
        currency0: NACRE_TEST_WETH, currency1: NACRE_TEST_USDC, fee, tickSpacing: 10,
        hooks: NACRE_HOOK, chainId: 84532, status: "draft" }));
      setSaved("Draft saved in this browser");
    } catch { setIssue("This browser could not save the draft. Your entries are still on this page."); }
  }
  useEffect(() => {
    if (!ready || completed) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ version: 1, priceUsd: priceInput, step,
          currency0: NACRE_TEST_WETH, currency1: NACRE_TEST_USDC, fee, tickSpacing: 10,
          hooks: NACRE_HOOK, chainId: 84532, status: "draft", reviewed: false }));
        setSaved("Draft saved in this browser");
      } catch { setSaved("Draft could not be saved in this browser"); }
    }, 300);
    return () => clearTimeout(timer);
  }, [priceInput, fee, step, ready, completed]);
  function next() {
    if (step === 1 && !validPrice) { setIssue("Enter a starting price between $0.01 and $1,000,000."); return; }
    if (step === 1 && exists) { setIssue("Choose an unused trading fee tier. This pool already exists."); return; }
    setIssue(""); setStep(step + 1);
  }
  const checks = [
    { label: "Token pair selected", ok: true },
    { label: "Base Sepolia network", ok: true },
    { label: "Fee tier and hook configured", ok: true },
    { label: "Valid starting price", ok: validPrice },
  ];

  if (created) return <div className="pcf-page"><Card className="pcf-success" role="status">
    <div className="pcf-success-mark"><CheckCircle2 size={32} /></div><Badge variant="outline">INITIALIZED</Badge>
    <h2>Your pool is created.</h2><p>Your nWETH / nUSDC pool is initialized on Base Sepolia. You can now choose a range and fund a bid.</p>
    <Button asChild className="pcf-primary"><Link href={`/dashboard/pools/${created.id}`}>Open pool & fund a bid <ArrowRight size={16} /></Link></Button>
    <Button asChild variant="outline"><a href={basescanTx(created.hash)} target="_blank" rel="noreferrer">View transaction</a></Button>
  </Card></div>;

  return <div className="pcf-page">
    <div className="pcf-topline"><Link href="/dashboard"><ArrowLeft size={15} /> Overview</Link><div><span aria-live="polite">{saved || "New local draft"}</span><Button type="button" variant="outline" className="pcf-discard-trigger" disabled={!ready || !!busy || !!pendingHash} onClick={() => setConfirmDiscard(true)}>Discard draft</Button><Button type="button" variant="outline" disabled={!ready || !!busy || !!pendingHash} onClick={() => saveDraft()}><Save size={15} /> Save draft</Button></div></div>
    {confirmDiscard && <div className="pcf-discard-confirm" role="group" aria-label="Discard saved draft"><div><strong>Discard this local draft?</strong><span>Your unfinished pool settings will be removed from this browser.</span></div><Button variant="outline" onClick={() => setConfirmDiscard(false)}>Keep draft</Button><Button className="pcf-discard-button" onClick={() => {
      try { localStorage.removeItem(KEY); setPriceInput(""); setStep(0); setConfirmDiscard(false); setIssue(""); setSaved(""); }
      catch { setIssue("This browser could not discard the draft."); }
    }}>Discard</Button></div>}
    <nav className="pcf-steps" aria-label="Pool creation steps">{steps.map((item, index) => {
      const Icon = item.icon;
      return <button key={item.title} type="button" className={`pcf-step${step === index ? " is-active" : ""}${step > index ? " is-done" : ""}`} aria-current={step === index ? "step" : undefined} onClick={() => { if (index < step) { setStep(index); setIssue(""); } }} disabled={index > step || !!busy || !!pendingHash}>
        <span className="pcf-step-icon">{step > index ? <Check size={17} /> : <Icon size={17} />}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>{index < 2 && <ArrowRight className="pcf-step-arrow" size={16} />}
      </button>;
    })}</nav>
    <div className="pcf-layout"><div className="pcf-main">
      <Card className="pcf-form-card"><div className="pcf-card-heading"><span>STEP 0{step + 1} / 03</span><h2>{steps[step].title}</h2><p>{step === 0 ? "Review the tokens and network for your pool." : step === 1 ? "Set the starting price and review the pool’s trading configuration." : "Check your pool settings before creating it on-chain."}</p></div>
        <fieldset disabled={!ready || !!busy || !!pendingHash} className="pcf-form-fields">
        {step === 0 && <div className="pcf-card-body">
          <div className="pcf-fixed-pair"><TokenPairIcon pair="nWETH / nUSDC" size="large" /><div><strong>nWETH / nUSDC</strong><span>Base Sepolia test pair</span></div><Badge variant="outline">FIXED PAIR</Badge></div>
          <dl className="pcf-review-list"><div><dt>Network</dt><dd>Base Sepolia</dd></div><div><dt>Base token</dt><dd>nWETH · 18 decimals</dd></div><div><dt>Quote token</dt><dd>nUSDC · 6 decimals</dd></div><div><dt>Protocol</dt><dd>Uniswap v4</dd></div></dl>
        </div>}
        {step === 1 && <div className="pcf-card-body">
          <div className="pcf-field-grid"><label className="pcf-field"><span>Starting nWETH price (USD)</span><Input type="number" inputMode="decimal" min="0.01" max="1000000" step="any" value={priceInput} onChange={(event) => { setPriceInput(event.target.value); setIssue(""); }} placeholder="0.00" /><small>Price of one nWETH in nUSDC.</small></label><label className="pcf-field"><span>Trading fee</span><select value={fee} onChange={(event) => { setFee(Number(event.target.value)); setIssue(""); }}>{OPEN_POOL_FEES.map((value) => <option key={value} value={value}>{value / 10000}%</option>)}</select><small>Each token pair, fee tier and hook identifies one pool.</small></label></div>
          <div className="pcf-oracle-row"><div><Activity size={16} /><span>{currentPrice ? `Current nWETH / nUSDC pool price · ${money(currentPrice)}` : priceError || "Loading current pool price…"}</span></div>{currentPrice && <Button type="button" variant="outline" onClick={() => { setPriceInput(currentPrice.toFixed(2)); setIssue(""); }}><RefreshCw size={14} /> Use current price</Button>}</div>
          <dl className="pcf-review-list"><div><dt>Protocol</dt><dd>Uniswap v4</dd></div><div><dt>Hook</dt><dd>Nacre fee hook</dd></div></dl>
        </div>}
        {step === 2 && <div className="pcf-card-body">
          <div className="pcf-review-pair"><TokenPairIcon pair="nWETH / nUSDC" size="large" /><div><strong>nWETH / nUSDC</strong><span>Uniswap v4 · Base Sepolia</span></div></div>
          <dl className="pcf-review-list"><div><dt>Network</dt><dd>Base Sepolia</dd></div><div><dt>Starting price</dt><dd>{money(price)}</dd></div><div><dt>Trading fee</dt><dd>{fee / 10000}%</dd></div><div><dt>Hook</dt><dd>Nacre fee hook</dd></div></dl>
          <div className="pcf-review-note"><CircleHelp size={17} /><p><strong>Create on Base Sepolia</strong> Confirm one wallet transaction to initialize the pool. You pay network gas. Funding a coverage bid is a separate step after creation.</p></div>
        </div>}
        </fieldset>
      </Card>
      {exists && !pendingHash && <p className="pcf-error" role="status">This pool already exists. Select an unused trading fee tier.</p>}
      {poolCheckError && <p role="status">{poolCheckError}</p>}
      {busy && <p role="status">{busy}</p>}
      {pendingHash && <p>Creation transaction submitted. <a href={basescanTx(pendingHash)} target="_blank" rel="noreferrer">View transaction</a>. Retry checks this transaction without creating another pool.</p>}
      {issue && <div className="pcf-error" role="alert"><CircleAlert size={18} /><div><strong>Check before continuing</strong><p>{issue}</p></div></div>}
      <div className="pcf-form-actions">{step > 0 ? <Button type="button" variant="outline" disabled={!!busy || !!pendingHash} onClick={() => { setStep(step - 1); setIssue(""); }}><ArrowLeft size={15} /> Back</Button> : <Button asChild variant="outline"><Link href="/dashboard">Cancel</Link></Button>}{step < 2 ? <Button type="button" className="pcf-primary" disabled={!ready || !!busy || !!pendingHash} onClick={next}>Next <ArrowRight size={16} /></Button> : <Button type="button" className="pcf-primary" disabled={!ready || !!busy || (!pendingHash && (!validPrice || !!exists))} onClick={() => void createPool()}>{busy || (pendingHash ? "Check transaction & register pool" : account ? "Create pool" : "Connect wallet")} <ArrowRight size={16} /></Button>}</div>
    </div><aside className="pcf-aside">
      <Card className="pcf-side-card"><div className="pcf-side-heading"><CircleHelp size={18} /><h3>Pool checks</h3></div><ul>{checks.map((check) => <li key={check.label} className={check.ok ? "is-passing" : "is-pending"}>{check.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{check.label}</li>)}</ul><p>Review the pair, network and starting price before creating your pool.</p></Card>
      <Card className="pcf-side-card"><div className="pcf-side-heading"><Database size={18} /><h3>Preview (draft)</h3></div><div className="pcf-preview-pair"><TokenPairIcon pair="nWETH / nUSDC" size="small" /><div><strong>nWETH / nUSDC</strong><small>Uniswap v4 · Base Sepolia</small></div></div><div className="pcf-preview-stats"><div><span>STARTING PRICE</span><strong>{money(price)}</strong></div><div><span>TRADING FEE</span><strong>{fee / 10000}%</strong></div><div><span>HOOK</span><strong>Nacre fee hook</strong></div></div><Badge variant="outline">POOL DRAFT</Badge></Card>
      <div className="pcf-sandbox-note"><ShieldCheck size={17} /><p>Any connected underwriter can create an available pool. You need Base Sepolia ETH for gas.</p></div>
    </aside></div>
  </div>;
}
