"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity, ArrowLeft, ArrowRight, Check, CheckCircle2, CircleAlert,
  CircleHelp, Database, Droplets, RefreshCw, Save, ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenPairIcon } from "@/components/token-pair-icon";

type PoolDraft = {
  priceUsd: string;
  lowerPriceUsd: string;
  upperPriceUsd: string;
  liquidityTargetUsd: string;
  collateralBudgetUsd: string;
};
type StoredDraft = { version: 1; values: PoolDraft; step: number; savedAt: string };
type LivePrice = { source: string; wethUsdc: number; assets: { WETH: { publishedAt: string } } };

const DRAFT_KEY = "nacre-pool-create-draft-v1";
const emptyDraft: PoolDraft = {
  priceUsd: "", lowerPriceUsd: "", upperPriceUsd: "",
  liquidityTargetUsd: "1000", collateralBudgetUsd: "100",
};
const steps = [
  { title: "Market & range", subtitle: "Pair, price and active ticks", icon: Activity },
  { title: "Funding targets", subtitle: "Liquidity and protection", icon: Droplets },
  { title: "Review & create", subtitle: "Check the launch conditions", icon: ShieldCheck },
];
const money = (value: string | number) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(amount)
    : "—";
};
const validAmount = (value: string, min: number, max: number) => {
  const amount = Number(value);
  return value.trim() !== "" && Number.isFinite(amount) && amount >= min && amount <= max;
};
const tickFor = (price: number) => Math.floor(Math.log(price) / Math.log(1.0001) / 10) * 10;

export function validatePoolDraft(values: PoolDraft, step: number): string[] {
  const issues: string[] = [];
  if (step === 0 || step === 2) {
    const price = Number(values.priceUsd);
    const lower = Number(values.lowerPriceUsd);
    const upper = Number(values.upperPriceUsd);
    if (!validAmount(values.priceUsd, 0.01, 1_000_000)) issues.push("Enter a starting WETH price between $0.01 and $1,000,000.");
    if (!validAmount(values.lowerPriceUsd, 0.01, 1_000_000)
      || !validAmount(values.upperPriceUsd, 0.01, 1_000_000)) {
      issues.push("Enter minimum and maximum prices between $0.01 and $1,000,000.");
    } else if (validAmount(values.priceUsd, 0.01, 1_000_000)) {
      if (!(lower < price && price < upper)) issues.push("The starting price must sit strictly inside the selected range.");
      else if (!(tickFor(lower) < tickFor(price) && tickFor(price) < tickFor(upper))) {
        issues.push("Widen the range so there is at least one tick spacing on each side of the starting price.");
      }
    }
  }
  if (step === 1 || step === 2) {
    if (!validAmount(values.liquidityTargetUsd, 100, 10_000_000)) {
      issues.push("The LP funding target must be between $100 and $10,000,000.");
    }
    if (!validAmount(values.collateralBudgetUsd, 1, 10_000_000)) {
      issues.push("The protection target must be between $1 and $10,000,000.");
    }
  }
  return issues;
}

function readDraft(): StoredDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed.version !== 1 || !parsed.values || !Number.isInteger(parsed.step)
      || parsed.step < 0 || parsed.step > 2) return null;
    if ((Object.keys(emptyDraft) as (keyof PoolDraft)[])
      .some((key) => typeof parsed.values[key] !== "string")) return null;
    return parsed;
  } catch { return null; }
}

function NumberField({ label, value, onChange, hint, min = 0.01 }: {
  label: string; value: string; onChange: (next: string) => void; hint?: string; min?: number;
}) {
  return <label className="pcf-field"><span>{label}</span><Input type="number" inputMode="decimal" min={min} step="any" value={value}
    onChange={(event) => onChange(event.target.value)} placeholder="0.00" />{hint && <small>{hint}</small>}</label>;
}

export function PoolCreateFlow() {
  const router = useRouter();
  const [values, setValues] = useState<PoolDraft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [participant, setParticipant] = useState("");
  const [live, setLive] = useState<LivePrice | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState("");
  const [draftError, setDraftError] = useState("");
  const [issues, setIssues] = useState<string[]>([]);
  const [serverError, setServerError] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createdId, setCreatedId] = useState("");

  useEffect(() => {
    const stored = readDraft();
    let id = localStorage.getItem("nacre-sandbox-participant");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("nacre-sandbox-participant", id); }
    queueMicrotask(() => {
      if (stored) { setValues(stored.values); setStep(Math.min(2, Math.max(0, stored.step))); setDraftSavedAt(stored.savedAt); }
      setParticipant(id);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/workspace/live-prices", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Live price unavailable");
        return await response.json() as LivePrice;
      })
      .then((price) => {
        if (!active) return;
        setLive(price);
        setValues((previous) => previous.priceUsd ? previous : {
          ...previous,
          priceUsd: price.wethUsdc.toFixed(2),
          lowerPriceUsd: previous.lowerPriceUsd || (price.wethUsdc * .9).toFixed(2),
          upperPriceUsd: previous.upperPriceUsd || (price.wethUsdc * 1.1).toFixed(2),
        });
      })
      .catch(() => { if (active) setLiveError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || createdId) return;
    const timer = setTimeout(() => {
      try {
        const savedAt = new Date().toISOString();
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, values, step, savedAt } satisfies StoredDraft));
        setDraftSavedAt(savedAt);
        setDraftError("");
      } catch { setDraftError("This browser could not save the draft locally."); }
    }, 0);
    return () => clearTimeout(timer);
  }, [values, step, ready, createdId]);

  useEffect(() => {
    if (!createdId) return;
    const timer = setTimeout(() => router.replace(`/dashboard/pools/${createdId}`), 4000);
    return () => clearTimeout(timer);
  }, [createdId, router]);

  function update(key: keyof PoolDraft, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setIssues([]);
    setServerError("");
  }
  function saveDraft() {
    try {
      const savedAt = new Date().toISOString();
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, values, step, savedAt } satisfies StoredDraft));
      setDraftSavedAt(savedAt);
      setDraftError("");
    } catch { setDraftError("This browser could not save the draft locally."); }
  }
  function nextStep() {
    const found = validatePoolDraft(values, step);
    setIssues(found);
    if (!found.length) { setServerError(""); setStep((current) => Math.min(2, current + 1)); }
  }
  async function createPool() {
    const found = validatePoolDraft(values, 2);
    setIssues(found);
    if (found.length || !participant || submitting) return;
    setSubmitting(true); setServerError("");
    try {
      const response = await fetch("/api/workspace/markets", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          creator: participant,
          priceUsd: Number(values.priceUsd),
          lowerPriceUsd: Number(values.lowerPriceUsd),
          upperPriceUsd: Number(values.upperPriceUsd),
          liquidityTargetUsd: Number(values.liquidityTargetUsd),
          collateralBudgetUsd: Number(values.collateralBudgetUsd),
        }),
      });
      const result = await response.json() as { market?: { id: string }; error?: string };
      if (!response.ok || !result.market?.id) throw new Error(result.error || "The pool could not be created. Try again.");
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* Creation succeeded even if storage cleanup is blocked. */ }
      setCreatedId(result.market.id);
    } catch (reason) {
      setServerError(reason instanceof Error ? reason.message : "The pool could not be created. Try again.");
    } finally { setSubmitting(false); }
  }

  const price = Number(values.priceUsd);
  const lower = Number(values.lowerPriceUsd);
  const upper = Number(values.upperPriceUsd);
  const rangeReady = validatePoolDraft(values, 0).length === 0;
  const marker = rangeReady ? Math.max(0, Math.min(100, (price - lower) / (upper - lower) * 100)) : 50;
  const checks = [
    { label: "Starting price inside the range", ok: lower < price && price < upper },
    { label: "A tick spacing on both sides", ok: rangeReady },
    { label: "LP target at least $100", ok: validAmount(values.liquidityTargetUsd, 100, 10_000_000) },
    { label: "Protection target at least $1", ok: validAmount(values.collateralBudgetUsd, 1, 10_000_000) },
  ];

  if (createdId) return <div className="pcf-page"><Card className="pcf-success" role="status">
    <div className="pcf-success-mark"><CheckCircle2 size={32} /></div>
    <Badge variant="outline">SANDBOX POOL CREATED</Badge>
    <h2>Pool draft is ready.</h2>
    <p>Your WETH / USDC market was saved on the local Bun server. It needs LP deposits and underwriter backing before the funding gate opens. No contract was deployed or tokens moved.</p>
    <div className="pcf-success-id"><span>POOL ID</span><code>{createdId}</code></div>
    <Button asChild className="pcf-primary"><Link href={`/dashboard/pools/${createdId}`}>Open pool now <ArrowRight size={16} /></Link></Button>
    <small>Opening the pool page automatically…</small>
  </Card></div>;

  return <div className="pcf-page">
    <div className="pcf-topline"><Link href="/dashboard/pools"><ArrowLeft size={15} /> Pool directory</Link><div><span aria-live="polite">{draftError || (draftSavedAt ? `Draft saved locally · ${new Date(draftSavedAt).toLocaleTimeString()}` : "New local draft")}</span><Button type="button" variant="outline" className="pcf-discard-trigger" onClick={() => setConfirmDiscard(true)}>Discard draft</Button><Button type="button" variant="outline" onClick={saveDraft}><Save size={15} /> Save draft</Button></div></div>
    {confirmDiscard && <div className="pcf-discard-confirm" role="group" aria-label="Discard saved draft"><div><strong>Discard this local draft?</strong><span>Your unfinished pool settings will be removed from this browser.</span></div><Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>Keep draft</Button><Button type="button" className="pcf-discard-button" onClick={() => { localStorage.removeItem(DRAFT_KEY); router.push("/dashboard/pools"); }}>Discard</Button></div>}
    <nav className="pcf-steps" aria-label="Pool creation steps">{steps.map((item, index) => {
      const Icon = item.icon;
      return <button key={item.title} type="button" className={`pcf-step${step === index ? " is-active" : ""}${step > index ? " is-done" : ""}`} aria-current={step === index ? "step" : undefined} onClick={() => { if (index < step) { setStep(index); setIssues([]); } }} disabled={index > step}>
        <span className="pcf-step-icon">{step > index ? <Check size={17} /> : <Icon size={17} />}</span>
        <span><strong>{item.title}</strong><small>{item.subtitle}</small></span>
        {index < steps.length - 1 && <ArrowRight className="pcf-step-arrow" size={16} />}
      </button>;
    })}</nav>

    <div className="pcf-layout"><div className="pcf-main">
      <Card className="pcf-form-card"><div className="pcf-card-heading"><span>STEP 0{step + 1} / 03</span><h2>{steps[step].title}</h2><p>{step === 0 ? "Choose the price interval where the first LP position can earn fees." : step === 1 ? "Set the two amounts that must be funded before the market opens." : "Confirm the terms that will be saved to the sandbox."}</p></div>
        {step === 0 && <div className="pcf-card-body">
          <div className="pcf-fixed-pair"><TokenPairIcon pair="WETH / USDC" size="large" /><div><strong>WETH / USDC</strong><span>Uniswap v4 concept · 0.05% fee</span></div><Badge variant="outline">FIXED PAIR</Badge></div>
          <div className="pcf-field-grid"><NumberField label="Starting WETH price (USD)" value={values.priceUsd} onChange={(value) => update("priceUsd", value)} hint="Sets the initial sandbox tick." /></div>
          <div className="pcf-oracle-row"><div><Activity size={16} /><span>{live ? `${live.source} WETH / USDC · ${money(live.wethUsdc)}` : liveError ? "Live oracle unavailable; enter a price manually." : "Loading live WETH / USDC price…"}</span></div>{live && <Button type="button" variant="outline" onClick={() => {
            setValues((previous) => ({ ...previous, priceUsd: live.wethUsdc.toFixed(2), lowerPriceUsd: (live.wethUsdc * .9).toFixed(2), upperPriceUsd: (live.wethUsdc * 1.1).toFixed(2) }));
            setIssues([]);
          }}><RefreshCw size={14} /> Use live price & ±10% range</Button>}</div>
          <div className="pcf-field-grid"><NumberField label="Minimum range price (USD)" value={values.lowerPriceUsd} onChange={(value) => update("lowerPriceUsd", value)} /><NumberField label="Maximum range price (USD)" value={values.upperPriceUsd} onChange={(value) => update("upperPriceUsd", value)} /></div>
          <div className="pcf-range-preview"><div><span>SELECTED LP RANGE</span><strong>{money(values.lowerPriceUsd)} <em>to</em> {money(values.upperPriceUsd)}</strong></div><div className="pcf-range-line"><i style={{ left: `${marker}%` }} /></div><small>{rangeReady ? `Starting price ${money(values.priceUsd)} is inside the range.` : "Choose prices that place the starting tick inside the range."}</small></div>
        </div>}
        {step === 1 && <div className="pcf-card-body">
          <div className="pcf-field-grid"><NumberField label="LP liquidity target (USD)" value={values.liquidityTargetUsd} onChange={(value) => update("liquidityTargetUsd", value)} min={100} hint="Minimum total LP deposits to open this draft." /><NumberField label="Protection capacity target (USD)" value={values.collateralBudgetUsd} onChange={(value) => update("collateralBudgetUsd", value)} min={1} hint="Minimum underwriter backing recorded for launch." /></div>
          <div className="pcf-funding-gate"><div className="pcf-gate-icon"><ShieldCheck size={20} /></div><div><strong>Both sides must fund the market</strong><p>Creating the draft does not fill either target. LPs add liquidity; underwriters record finite capacity. Every covered position reserves its full payout cap, so the same capacity cannot back two policies.</p></div></div>
          <div className="pcf-funding-summary"><div><span>LP TARGET</span><strong>{money(values.liquidityTargetUsd)}</strong><small>0% funded at creation</small></div><div><span>PROTECTION TARGET</span><strong>{money(values.collateralBudgetUsd)}</strong><small>0% backed at creation</small></div></div>
        </div>}
        {step === 2 && <div className="pcf-card-body">
          <div className="pcf-review-pair"><TokenPairIcon pair="WETH / USDC" size="large" /><div><strong>WETH / USDC</strong><span>0.05% fee · sandbox market draft</span></div></div>
          <dl className="pcf-review-list"><div><dt>Starting price</dt><dd>{money(values.priceUsd)}</dd></div><div><dt>Selected LP range</dt><dd>{money(values.lowerPriceUsd)}–{money(values.upperPriceUsd)}</dd></div><div><dt>LP funding target</dt><dd>{money(values.liquidityTargetUsd)}</dd></div><div><dt>Protection target</dt><dd>{money(values.collateralBudgetUsd)}</dd></div></dl>
          <div className="pcf-review-note"><CircleHelp size={17} /><p><strong>What happens next?</strong> The server creates an unfunded pool record. The pool opens only after both funding targets are met. New coverage can still fail if the tick leaves the range, backing is exhausted, or the quoted net floor fails the model checks. This action does not deploy a contract.</p></div>
        </div>}
      </Card>
      {(issues.length > 0 || serverError) && <div className="pcf-error" role="alert"><CircleAlert size={18} /><div><strong>{serverError ? "Pool creation failed" : "Check these fields"}</strong>{serverError && <p>{serverError}</p>}{issues.map((issue) => <p key={issue}>{issue}</p>)}<small>Your draft remains saved in this browser. Correct the details and try again.</small></div></div>}
      <div className="pcf-form-actions">{step > 0 ? <Button type="button" variant="outline" onClick={() => { setStep((current) => current - 1); setIssues([]); setServerError(""); }}><ArrowLeft size={15} /> Back</Button> : <Button asChild variant="outline"><Link href="/dashboard/pools">Cancel</Link></Button>}
        {step < 2 ? <Button type="button" className="pcf-primary" onClick={nextStep}>Next <ArrowRight size={16} /></Button> : <Button type="button" className="pcf-primary" disabled={submitting || !participant || !ready} onClick={() => void createPool()}>{submitting ? "Creating pool…" : "Create sandbox pool"} <ArrowRight size={16} /></Button>}
      </div>
    </div><aside className="pcf-aside">
      <Card className="pcf-side-card"><div className="pcf-side-heading"><CircleHelp size={18} /><h3>Launch checks</h3></div><ul>{checks.map((check) => <li key={check.label} className={check.ok ? "is-passing" : "is-pending"}>{check.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}{check.label}</li>)}</ul><p>{step === 0 ? "The selected interval determines when liquidity can earn trading fees." : "The draft can exist before funding; coverage becomes available only when the market and quote checks pass."}</p></Card>
      <Card className="pcf-side-card"><div className="pcf-side-heading"><Database size={18} /><h3>Preview (draft)</h3></div><div className="pcf-preview-pair"><TokenPairIcon pair="WETH / USDC" size="small" /><div><strong>WETH / USDC</strong><small>0.05% fee · local sandbox</small></div></div><div className="pcf-preview-stats"><div><span>STARTING PRICE</span><strong>{money(values.priceUsd)}</strong></div><div><span>RANGE</span><strong>{money(values.lowerPriceUsd)}–{money(values.upperPriceUsd)}</strong></div><div><span>LP / PROTECTION</span><strong>{money(values.liquidityTargetUsd)} / {money(values.collateralBudgetUsd)}</strong></div></div><Badge variant="outline">UNFUNDED DRAFT</Badge></Card>
      <div className="pcf-sandbox-note"><ShieldCheck size={17} /><p>Saved drafts stay in this browser. Created pools are stored by the local Bun server. Neither step writes to Base or deploys a Uniswap pool.</p></div>
    </aside></div>
  </div>;
}
