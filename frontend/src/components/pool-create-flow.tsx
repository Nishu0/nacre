"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert, CircleHelp, Database, RefreshCw, Save, ShieldCheck, Wallet } from "lucide-react";
import { parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { Input } from "@/components/ui/input";
import { useCoverageAction } from "@/components/coverage-workspace";
import { injectedClient, priceToRawTick, priceInputToTick } from "@/lib/nacre-chain";
import { rangeFactoryAbi, tickPrice } from "@/lib/coverage-contracts";
import { TEST_WETH_FACTORY, TEST_WETH_POOL } from "@/lib/test-pools";
import { useCoverage } from "@/lib/use-coverage";

const KEY = "nacre-funded-pool-draft-v1";
const defaults = { lower: "", upper: "", capital: "100", days: "30", premium: "8" };
type Draft = typeof defaults;
// Original wizard layout restored from 00280c1; submission uses funded bids.
const steps = [
  { title: "Market & range", subtitle: "Choose the bins to cover", icon: Activity },
  { title: "Funding terms", subtitle: "Capital, days and premium", icon: Wallet },
  { title: "Review & create", subtitle: "Fund your bid on Base Sepolia", icon: ShieldCheck },
];
const money = (n: number) => Number.isFinite(n) && n > 0 ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

function NumberField({ label, value, onChange, hint, min = 0.01 }: {
  label: string; value: string; onChange: (next: string) => void; hint?: string; min?: number;
}) {
  return <label className="pcf-field"><span>{label}</span><Input type="number" inputMode="decimal" min={min} step="any" value={value}
    onChange={(event) => onChange(event.target.value)} placeholder="0.00" />{hint && <small>{hint}</small>}</label>;
}

export function PoolCreateFlow({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  const router = useRouter();
  const rangeInitialized = useRef(false);
  const action = useCoverageAction(account);
  const { data, error } = useCoverage(TEST_WETH_POOL);
  const [values, setValues] = useState<Draft>(defaults);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState("");
  const [issue, setIssue] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [created, setCreated] = useState(false);
  const [bounds, setBounds] = useState<{ lower: number; upper: number } | null>(null);
  const [configError, setConfigError] = useState("");

  useEffect(() => {
    let draft = defaults;
    let page = 0;
    try {
      const stored = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (stored?.version === 1 && Object.keys(defaults).every((key) => typeof stored.values?.[key] === "string")) {
        draft = stored.values;
        page = Number.isInteger(stored.step) ? Math.max(0, Math.min(2, stored.step)) : 0;
      }
    } catch { /* An unavailable or invalid draft starts empty. */ }
    queueMicrotask(() => { setValues(draft); setStep(page); setReady(true); });
    const controller = new AbortController();
    void fetch("/api/workspace/bid-market", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result.market; })
      .then((market) => { if (!controller.signal.aborted) setBounds({ lower: market.lowerPriceUsd, upper: market.upperPriceUsd }); })
      .catch((reason) => { if (!controller.signal.aborted) setConfigError(reason.message); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!ready || !data || rangeInitialized.current) return;
    rangeInitialized.current = true;
    const currentPrice = tickPrice(data.currentTick);
    queueMicrotask(() => setValues((previous) => previous.lower || previous.upper ? previous : {
      ...previous, lower: (currentPrice * .9).toFixed(2), upper: (currentPrice * 1.1).toFixed(2),
    }));
  }, [ready, data]);

  function saveDraft() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ version: 1, values, step }));
      setSaved("Draft saved in this browser");
    } catch { setSaved("Draft could not be saved in this browser"); }
  }
  useEffect(() => {
    if (!ready || created) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ version: 1, values, step }));
        setSaved("Draft saved in this browser");
      } catch { setSaved("Draft could not be saved in this browser"); }
    }, 300);
    return () => clearTimeout(timer);
  }, [values, step, ready, created]);
  useEffect(() => {
    if (!created) return;
    const timer = setTimeout(() => router.push("/dashboard/pools"), 3500);
    return () => clearTimeout(timer);
  }, [created, router]);

  const lower = priceInputToTick(values.lower);
  const upper = priceInputToTick(values.upper);
  const bps = Math.round(Number(values.premium) * 100);
  const validRange = !!bounds && Number.isFinite(lower) && Number.isFinite(upper) && lower < upper
    && tickPrice(lower) >= bounds.lower && tickPrice(upper) <= bounds.upper;
  const validTerms = /^\d+(\.\d{1,6})?$/.test(values.capital) && Number.isFinite(Number(values.capital)) && Number(values.capital) > 0
    && [7, 14, 30, 60, 90].includes(Number(values.days)) && /^\d+(\.\d{1,2})?$/.test(values.premium) && bps > 0 && bps <= 10000;
  const update = (key: keyof Draft, value: string) => { setValues((previous) => ({ ...previous, [key]: value })); setIssue(""); };
  function next() {
    if (!validRange || (step === 1 && !validTerms)) {
      setIssue(!validRange ? "Enter a valid range inside the supported pool bounds." : "Enter positive capital, a duration, and a premium between 0.01% and 100%.");
      return;
    }
    setIssue(""); setStep(step + 1);
  }
  const create = () => action.run(async (owner) => {
    if (!validRange || !validTerms || !data?.configured || error || configError || created) throw new Error("Check the range and funding terms before creating.");
    await action.approve(owner, TEST_WETH_FACTORY, parseUnits(values.capital, 6));
    action.setStep("Confirm your funded bid in your wallet…");
    await action.confirm(await injectedClient().writeContract({ account: owner, address: TEST_WETH_FACTORY,
      abi: rangeFactoryAbi, functionName: "createOffer", args: [parseUnits(values.capital, 6), lower, upper, Number(values.days) * 86400, bps] }));
    setCreated(true);
    try { localStorage.removeItem(KEY); } catch { /* The confirmed bid is already on-chain. */ }
  });
  const price = data ? tickPrice(data.currentTick) : 0;
  const inRange = !!data && validRange && data.currentTick >= lower && data.currentTick < upper;
  const marker = validRange && data ? Math.max(0, Math.min(100, (price - tickPrice(lower)) / (tickPrice(upper) - tickPrice(lower)) * 100)) : 50;
  const checks = [
    { label: "Valid price range and aligned bins", ok: validRange },
    { label: "Funding amount, duration and premium set", ok: validTerms },
    { label: "Base Sepolia connection ready", ok: !!data?.configured && !error && !configError },
    { label: "Underwriter wallet connected", ok: !!account },
  ];

  if (created) return <div className="pcf-page"><Card className="pcf-success" role="status"><div className="pcf-success-mark"><CheckCircle2 size={32} /></div><Badge variant="outline">BID FUNDED</Badge><h2>Your coverage range is live.</h2><p>Investors can select these bins and buy coverage using your funded nUSDC. The existing nWETH / nUSDC pool handles their liquidity.</p>{action.feedback}<Button asChild className="pcf-primary"><Link href="/dashboard/pools">View funded bids <ArrowRight size={16} /></Link></Button><small>Opening funded bids…</small></Card></div>;

  return <div className="pcf-page">
    <div className="pcf-topline"><Link href="/dashboard/pools"><ArrowLeft size={15} /> Coverage bids</Link><div><span aria-live="polite">{saved || "New local draft"}</span><Button type="button" variant="outline" className="pcf-discard-trigger" disabled={!ready || action.busy} onClick={() => setConfirmDiscard(true)}>Discard draft</Button><Button type="button" variant="outline" disabled={!ready || action.busy} onClick={saveDraft}><Save size={15} /> Save draft</Button></div></div>
    {confirmDiscard && <div className="pcf-discard-confirm" role="group" aria-label="Discard saved draft"><div><strong>Discard this local draft?</strong><span>Your unfinished pool settings will be removed from this browser.</span></div><Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>Keep draft</Button><Button type="button" className="pcf-discard-button" onClick={() => {
      try { localStorage.removeItem(KEY); setReady(false); router.push("/dashboard/pools"); }
      catch { setSaved("This browser could not discard the draft."); }
    }}>Discard</Button></div>}
    <nav className="pcf-steps" aria-label="Pool creation steps">{steps.map((item, index) => {
      const Icon = item.icon;
      return <button key={item.title} type="button" className={`pcf-step${step === index ? " is-active" : ""}${step > index ? " is-done" : ""}`} aria-current={step === index ? "step" : undefined} onClick={() => { if (index < step) { setStep(index); setIssue(""); } }} disabled={index > step || action.busy}>
        <span className="pcf-step-icon">{step > index ? <Check size={17} /> : <Icon size={17} />}</span>
        <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
        {index < steps.length - 1 && <ArrowRight className="pcf-step-arrow" size={16} />}
      </button>;
    })}</nav>

    <div className="pcf-layout"><div className="pcf-main">
      <Card className="pcf-form-card"><div className="pcf-card-heading"><span>STEP 0{step + 1} / 03</span><h2>{steps[step].title}</h2><p>{step === 0 ? "Choose the price interval where investors can provide liquidity with your coverage." : step === 1 ? "Set the capital, duration and premium for your funded range." : "Confirm the exact terms before funding your bid on Base Sepolia."}</p></div>
        <fieldset disabled={!ready || action.busy} className="pcf-form-fields">
        {step === 0 && <div className="pcf-card-body">
          <div className="pcf-fixed-pair"><TokenPairIcon pair="nWETH / nUSDC" size="large" /><div><strong>nWETH / nUSDC</strong><span>Base Sepolia test pair · 0.05% fee</span></div><Badge variant="outline">FIXED PAIR</Badge></div>
          <div className="pcf-field-grid"><label className="pcf-field"><span>Current pool price (USD)</span><Input readOnly value={data ? price.toFixed(2) : ""} placeholder="Loading pool price…" /><small>Read from the deployed pool. Your bid uses its existing price.</small></label></div>
          <div className="pcf-oracle-row"><div><Activity size={16} /><span>{data ? `On-chain nWETH / nUSDC · ${money(price)}` : "Loading current pool price…"}</span></div>{data && <Button type="button" variant="outline" onClick={() => {
            setValues((previous) => ({ ...previous, lower: (price * .9).toFixed(2), upper: (price * 1.1).toFixed(2) }));
            setIssue("");
          }}><RefreshCw size={14} /> Use current price & ±10% range</Button>}</div>
          <div className="pcf-field-grid"><NumberField label="Minimum range price (USD)" value={values.lower} onChange={(value) => update("lower", value)} /><NumberField label="Maximum range price (USD)" value={values.upper} onChange={(value) => update("upper", value)} /></div>
          {bounds && <small>Supported range: {money(tickPrice(priceToRawTick(bounds.lower) + 10))}–{money(tickPrice(priceToRawTick(bounds.upper)))}</small>}
          <div className="pcf-range-preview"><div><span>SELECTED LP RANGE</span><strong>{money(tickPrice(lower))} <em>to</em> {money(tickPrice(upper))}</strong></div><div className="pcf-range-line"><i style={{ left: `${marker}%` }} /></div><small>{validRange ? `${(upper - lower) / 10} bins · ticks ${lower} to ${upper}${data ? inRange ? " · Current pool price is inside this range." : " · Investors can buy when the pool price enters this range." : ""}` : "Choose minimum and maximum prices to preview the exact bins."}</small></div>
        </div>}
        {step === 1 && <div className="pcf-card-body">
          <div className="pcf-field-grid"><NumberField label="Protection capital (nUSDC)" value={values.capital} onChange={(value) => update("capital", value)} min={0.000001} hint="The amount you deposit to back investors’ fee caps." /><NumberField label="Premium (% of protected fee cap)" value={values.premium} onChange={(value) => update("premium", value)} hint="Paid by each investor when they buy coverage." /><label className="pcf-field"><span>Coverage duration</span><select value={values.days} onChange={(event) => update("days", event.target.value)}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select><small>Investors use the duration you set for this bid.</small></label></div>
          <div className="pcf-funding-gate"><div className="pcf-gate-icon"><ShieldCheck size={20} /></div><div><strong>Fund the range before investors buy</strong><p>Your capital backs the selected bins. Each covered position reserves its full fee cap, so the same capital cannot back two policies at once. Investors can only purchase within your available capacity.</p></div></div>
          <div className="pcf-funding-summary"><div><span>PROTECTION CAPITAL</span><strong>{money(Number(values.capital))}</strong><small>Deposited when you confirm creation</small></div><div><span>PREMIUM ON A 10 nUSDC CAP</span><strong>{validTerms ? money(10 * bps / 10000) : "—"}</strong><small>For {values.days} days of fee coverage</small></div></div>
        </div>}
        {step === 2 && <div className="pcf-card-body">
          <div className="pcf-review-pair"><TokenPairIcon pair="nWETH / nUSDC" size="large" /><div><strong>nWETH / nUSDC</strong><span>0.05% fee · Base Sepolia</span></div></div>
          <dl className="pcf-review-list"><div><dt>Current pool price</dt><dd>{data ? money(price) : "—"}</dd></div><div><dt>Selected LP range</dt><dd>{money(tickPrice(lower))}–{money(tickPrice(upper))}</dd></div><div><dt>Total bins</dt><dd>{validRange ? (upper - lower) / 10 : "—"}</dd></div><div><dt>Protection capital</dt><dd>{values.capital} nUSDC</dd></div><div><dt>Coverage duration</dt><dd>{values.days} days</dd></div><div><dt>Premium</dt><dd>{values.premium}% of each fee cap</dd></div></dl>
          <div className="pcf-review-note"><CircleHelp size={17} /><p><strong>What happens next?</strong> Approve and deposit {values.capital} nUSDC to create a funded bid for this existing Uniswap pool. Investors select your exact bins and days, then pay the premium to activate coverage. Claims can consume the full reserved cap; unused capital can be withdrawn.</p></div>
        </div>}
        </fieldset>
      </Card>
      {(issue || error || configError) && <div className="pcf-error" role="alert"><CircleAlert size={18} /><div><strong>Check before continuing</strong><p>{issue || error || configError}</p><small>Your draft remains saved in this browser.</small></div></div>}
      {action.feedback}
      <div className="pcf-form-actions">{step > 0 ? <Button type="button" variant="outline" disabled={action.busy} onClick={() => { setStep(step - 1); setIssue(""); }}><ArrowLeft size={15} /> Back</Button> : <Button asChild variant="outline"><Link href="/dashboard/pools">Cancel</Link></Button>}
        {step < 2 ? <Button type="button" className="pcf-primary" disabled={!ready || !bounds} onClick={next}>Next <ArrowRight size={16} /></Button> : !account ? <Button type="button" className="pcf-primary" onClick={() => void onConnect()}>Connect wallet</Button> : <Button type="button" className="pcf-primary" disabled={action.busy || !validRange || !validTerms || !data?.configured || !!error || !!configError} onClick={() => void create()}>{action.busy ? action.step : "Create & fund bid"} <ArrowRight size={16} /></Button>}
      </div>
    </div><aside className="pcf-aside">
      <Card className="pcf-side-card"><div className="pcf-side-heading"><CircleHelp size={18} /><h3>Launch checks</h3></div><ul>{checks.map((check) => <li key={check.label} className={check.ok ? "is-passing" : "is-pending"}>{check.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{check.label}</li>)}</ul><p>{step === 0 ? "The selected interval defines the exact bins investors can use." : "Coverage becomes active when an investor purchases your funded bid."}</p></Card>
      <Card className="pcf-side-card"><div className="pcf-side-heading"><Database size={18} /><h3>Preview (draft)</h3></div><div className="pcf-preview-pair"><TokenPairIcon pair="nWETH / nUSDC" size="small" /><div><strong>nWETH / nUSDC</strong><small>0.05% fee · Base Sepolia</small></div></div><div className="pcf-preview-stats"><div><span>CURRENT POOL PRICE</span><strong>{data ? money(price) : "—"}</strong></div><div><span>RANGE</span><strong>{money(tickPrice(lower))}–{money(tickPrice(upper))}</strong></div><div><span>PROTECTION CAPITAL</span><strong>{money(Number(values.capital))}</strong></div><div><span>DURATION / PREMIUM</span><strong>{values.days} days / {values.premium || "0"}%</strong></div></div><Badge variant="outline">UNFUNDED DRAFT</Badge></Card>
      <div className="pcf-sandbox-note"><ShieldCheck size={17} /><p>Drafts stay in this browser. The final step funds your bid on Base Sepolia. No tokens move until you approve the wallet transactions.</p></div>
    </aside></div>
  </div>;
}
