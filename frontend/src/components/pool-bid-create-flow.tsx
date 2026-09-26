"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, Save, ShieldCheck, Wallet } from "lucide-react";
import { parseUnits } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useCoverageAction } from "@/components/coverage-workspace";
import { injectedClient, priceToRawTick } from "@/lib/nacre-chain";
import { rangeFactoryAbi, tickPrice } from "@/lib/coverage-contracts";
import { TEST_WETH_FACTORY, TEST_WETH_POOL } from "@/lib/test-pools";
import { useCoverage } from "@/lib/use-coverage";

const KEY = "nacre-funded-pool-draft-v1";
const defaults = { lower: "", upper: "", capital: "100", days: "30", premium: "8" };
type Draft = typeof defaults;
const steps = [
  { title: "Market & range", subtitle: "Choose the bins to cover", icon: Activity },
  { title: "Funding terms", subtitle: "Capital, days and premium", icon: Wallet },
  { title: "Review & create", subtitle: "Fund your bid on Base Sepolia", icon: ShieldCheck },
];
const money = (n: number) => Number.isFinite(n) && n > 0 ? n.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "—";

export function PoolBidCreateFlow({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  const router = useRouter();
  const action = useCoverageAction(account);
  const { data, error } = useCoverage(TEST_WETH_POOL);
  const [values, setValues] = useState<Draft>(defaults);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState("");
  const [issue, setIssue] = useState("");
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

  const lower = priceToRawTick(Number(values.lower));
  const upper = priceToRawTick(Number(values.upper));
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
  const field = (key: keyof Draft, label: string) => <label className="pcf-field"><span>{label}</span><Input type="number" step="any" min="0" value={values[key]} onChange={(event) => update(key, event.target.value)} /></label>;

  if (created) return <div className="pcf-page"><Card className="pcf-success" role="status"><div className="pcf-success-mark"><CheckCircle2 size={32} /></div><Badge variant="outline">BID FUNDED</Badge><h2>Your coverage range is live.</h2><p>Investors can select these bins and buy coverage using your funded nUSDC. The existing nWETH / nUSDC pool handles their liquidity.</p>{action.feedback}<Button asChild className="pcf-primary"><Link href="/dashboard/pools">View funded bids <ArrowRight size={16} /></Link></Button><small>Opening funded bids…</small></Card></div>;

  return <div className="pcf-page">
    <div className="pcf-topline"><Link href="/dashboard/pools"><ArrowLeft size={15} /> Coverage bids</Link><div><span role="status">{saved}</span><Button variant="outline" disabled={!ready || action.busy} onClick={saveDraft}><Save size={15} /> Save draft</Button></div></div>
    <nav className="pcf-steps" aria-label="Pool creation steps">{steps.map((item, index) => { const Icon = item.icon; return <button key={item.title} className={`pcf-step${step === index ? " is-active" : ""}${step > index ? " is-done" : ""}`} aria-current={step === index ? "step" : undefined} disabled={index > step || action.busy} onClick={() => { setStep(index); setIssue(""); }}><span className="pcf-step-icon">{index < step ? <Check size={17} /> : <Icon size={17} />}</span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span>{index < 2 && <ArrowRight size={16} className="pcf-step-arrow" />}</button>; })}</nav>
    <div className="pcf-layout"><div className="pcf-main"><Card className="pcf-form-card"><div className="pcf-card-heading"><span>STEP 0{step + 1} / 03</span><h2>{steps[step].title}</h2><p>{steps[step].subtitle}</p></div>
      <fieldset disabled={!ready || action.busy} className="pcf-card-body">
        {step === 0 && <><div className="pcf-fixed-pair"><strong>nWETH / nUSDC</strong><Badge variant="outline">BASE SEPOLIA · 0.05%</Badge></div><div className="pcf-oracle-row"><span>On-chain pool price: {data ? money(tickPrice(data.currentTick)) : "Loading…"}</span><Button variant="outline" disabled={!data} onClick={() => { if (data) setValues((previous) => ({ ...previous, lower: (tickPrice(data.currentTick) * .9).toFixed(2), upper: (tickPrice(data.currentTick) * 1.1).toFixed(2) })); }}>Use ±10% range</Button></div><div className="pcf-field-grid">{field("lower", "Minimum nWETH price (USD)")}{field("upper", "Maximum nWETH price (USD)")}</div>{bounds && <small>Supported range: {money(tickPrice(priceToRawTick(bounds.lower) + 10))}–{money(tickPrice(priceToRawTick(bounds.upper)))}</small>}<p>{validRange ? `${(upper - lower) / 10} bins · ticks ${lower} to ${upper}` : "Choose the range you want to underwrite."}</p></>}
        {step === 1 && <><div className="pcf-field-grid">{field("capital", "Capital to fund (nUSDC)")}{field("premium", "Premium (% of protected fee cap)")}<label className="pcf-field"><span>Coverage duration</span><select value={values.days} onChange={(event) => update("days", event.target.value)}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select></label></div><p>Investors use your exact bins and duration. Their protected fee caps cannot exceed the available funded capital.</p></>}
        {step === 2 && <><dl className="pcf-review-list"><div><dt>Pool</dt><dd>nWETH / nUSDC</dd></div><div><dt>Exact range</dt><dd>{money(tickPrice(lower))}–{money(tickPrice(upper))}</dd></div><div><dt>Total bins</dt><dd>{(upper - lower) / 10}</dd></div><div><dt>Funded capital</dt><dd>{values.capital} nUSDC</dd></div><div><dt>Duration</dt><dd>{values.days} days</dd></div><div><dt>Premium</dt><dd>{values.premium}% of each fee cap</dd></div></dl><p>Creating transfers {values.capital} nUSDC into your range bid. It uses the existing Uniswap pool. Investors pay premiums when buying; claims can consume the full reserved cap. Unused capital can be withdrawn.</p></>}
      </fieldset></Card>
      {(issue || error || configError) && <p className="pcf-error" role="alert">{issue || error || configError}</p>}{action.feedback}
      <div className="pcf-form-actions">{step > 0 ? <Button variant="outline" disabled={action.busy} onClick={() => { setStep(step - 1); setIssue(""); }}><ArrowLeft size={15} /> Back</Button> : <Button asChild variant="outline"><Link href="/dashboard">Cancel</Link></Button>}{step < 2 ? <Button className="pcf-primary" disabled={!ready || !bounds} onClick={next}>Next <ArrowRight size={16} /></Button> : !account ? <Button className="pcf-primary" onClick={() => void onConnect()}>Connect wallet</Button> : <Button className="pcf-primary" disabled={action.busy || !validRange || !validTerms || !data?.configured || !!error || !!configError} onClick={() => void create()}>{action.busy ? action.step : "Create & fund bid"} <ArrowRight size={16} /></Button>}</div>
    </div><aside className="pcf-aside"><Card className="pcf-side-card"><div className="pcf-side-heading"><ShieldCheck size={18} /><h3>Preview (draft)</h3></div><div className="pcf-preview-stats"><div><span>PAIR</span><strong>nWETH / nUSDC</strong></div><div><span>RANGE</span><strong>{money(tickPrice(lower))}–{money(tickPrice(upper))}</strong></div><div><span>CAPITAL</span><strong>{values.capital || "0"} nUSDC</strong></div><div><span>TERMS</span><strong>{values.days} days · {values.premium || "0"}% premium</strong></div></div><Badge variant="outline">UNFUNDED DRAFT</Badge></Card></aside></div>
  </div>;
}
