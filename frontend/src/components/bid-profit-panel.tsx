"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { ChartNoAxesCombined, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { bidProfitScenarios, type BidFundingTerms } from "@/lib/bid-profit";
import type { YieldDay } from "@/lib/underwriting-simulator";
const amount = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 4 });
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${amount(Math.abs(value))}`;

function ScenarioMotion({ kind, claimShare }: { kind: "best" | "median" | "worst"; claimShare: number }) {
  return <svg viewBox="0 0 210 92" aria-hidden="true" className={`bps-motion bps-motion-${kind}`}>
    {kind === "median" ? Array.from({ length: 24 }, (_, i) => <rect key={i} className="bps-tile" x={8 + (i % 8) * 25} y={10 + Math.floor(i / 8) * 25} width="18" height="17" rx="2"
      fill={i < Math.round(24 * claimShare) ? "#b86647" : "#478761"} style={{ "--delay": `${i * 65}ms` } as CSSProperties} />)
      : <><line x1="6" y1="79" x2="204" y2="79" stroke="#d5dfd7" />{[16, 27, 38, 49, 60, 71].map((height, i) => <rect key={i} className="bps-bar" x={10 + i * 33} y={79 - (kind === "best" ? height : 87 - height)} width="22" height={kind === "best" ? height : 87 - height} rx="2" fill={kind === "best" ? "#478761" : "#b86647"} opacity={.35 + i * .12} style={{ "--delay": `${i * 110}ms` } as CSSProperties} />)}</>}
  </svg>;
}
export function BidProfitPanel({ terms, validRange, inRange, feeTier }: { terms: BidFundingTerms; validRange: boolean; inRange: boolean; feeTier: string }) {
  const [history, setHistory] = useState<YieldDay[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [principal, setPrincipal] = useState("1000");
  const [cap, setCap] = useState("10");
  const [replay, setReplay] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/research/pools/usdc-weth-005/backtest?principalUsd=1000", { signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Historical median unavailable. Best and worst cases still show the payout limits."); return response.json(); })
      .then((data) => { if (!controller.signal.aborted) { setHistory(data.yieldHistory ?? []); if (!data.yieldHistory?.length) setHistoryError("No historical fee observations are available."); } })
      .catch((error) => { if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Historical data unavailable."); });
    return () => controller.abort();
  }, []);
  const result = validRange && /^\d+(\.\d{1,6})?$/.test(terms.capital) && /^\d+(\.\d{1,6})?$/.test(cap)
    ? bidProfitScenarios(history, { capital: Number(terms.capital), days: terms.days, premiumPct: Number(terms.rate), principal: Number(principal), cap: Number(cap) }) : null;
  const rows = result ? [
    { kind: "best" as const, title: "Best case", note: "LP fees meet every target. You keep all premiums.", value: result.best },
    { kind: "median" as const, title: "Median case", note: "Median payout across historical fee windows, assuming the range stays active.", value: result.median },
    { kind: "worst" as const, title: "Worst case", note: "Every covered LP earns zero fees. You pay every cap in full.", value: result.worst },
  ] : [];
  return <Card className="kd-card bps-panel">
    <div className="kd-card-heading"><h2><ChartNoAxesCombined size={16} /> Your profit scenarios</h2><button type="button" className="bps-replay" onClick={() => setReplay((n) => n + 1)} aria-label="Replay scenario animations"><RotateCcw size={14} /> Replay</button></div>
    <div className="bps-body">
      <p className="bps-intro">Premiums earned − claims paid = your net profit</p>
      <details className="bps-assumptions"><summary>Example: {amount(Number(principal) || 0)} nUSDC LP · {amount(Number(cap) || 0)} nUSDC fee cap <span>Edit</span></summary><div className="bps-inputs">
        <label className="mw-field"><span>Example LP size (nUSDC)</span><Input type="number" min="1" value={principal} onChange={(event) => setPrincipal(event.target.value)} /></label>
        <label className="mw-field"><span>Fee cap per position (nUSDC)</span><Input type="number" min="0.000001" step="0.000001" value={cap} onChange={(event) => setCap(event.target.value)} /></label>
      </div><p>These inputs only change the simulation. Each LP chooses its fee cap, subject to its position’s contract limit.</p></details>
      {!result ? <p role="status">Enter valid bid terms, an ordered range, and positive example amounts to see profit scenarios.</p> : <>
        <div className="bps-summary"><span><strong>{result.count}</strong> example positions</span><span><strong>{terms.days}</strong> days</span><span><strong>{amount(result.premiums)}</strong> nUSDC premiums</span></div>
        {Number(cap) > Number(principal) * .2 * terms.days / 365 && <p role="status" className="bps-note">This example cap exceeds the indicative position limit for {terms.days} days. Reduce it in the example settings; actual limits depend on the LP position.</p>}
        {result.count === 0 && <p role="status">Your capital is below one example fee cap. Lower the simulated cap or increase capital.</p>}
        {!inRange && <p className="bps-note">The pool price is outside these bins. These scenarios assume purchases become available after it returns inside.</p>}
        <div key={`${terms.capital}:${terms.rate}:${terms.days}:${principal}:${cap}:${replay}:${result.windows}`} className="bps-rows">{rows.map((row) => <section className={`bps-row bps-${row.kind}`} key={row.kind} aria-label={row.title}>
          <div className="bps-result"><h3>{row.title}{row.kind === "median" && <span>HISTORICAL PROXY</span>}</h3>
            <div className={`bps-profit ${row.value && row.value.profit < 0 ? "is-loss" : ""}`}><strong>{row.value ? signed(row.value.profit) : "—"}</strong><span>nUSDC net</span></div>
            <p>{row.note}</p>
            {row.value && <dl><div><dt>Claims paid</dt><dd>{amount(row.value.claims)}</dd></div><div><dt>Ending capital</dt><dd>{amount(row.value.ending)}</dd></div><div><dt>Return on capital</dt><dd>{signed(row.value.returnPct)}%</dd></div></dl>}
          </div><div className="bps-visual">{row.value ? <ScenarioMotion kind={row.kind} claimShare={result.reserved ? row.value.claims / result.reserved : 0} /> : <span>{historyError || (history.length ? "Not enough consecutive observations for this duration." : "Loading historical median…")}</span>}<small>{row.kind === "best" ? "Premiums retained" : row.kind === "median" ? "Green: retained · rust: claims" : "Full-cap payouts"}</small></div>
        </section>)}</div>
        <p className="bps-note">Assumes all {result.count} example positions buy once, with {amount(result.idle)} nUSDC left idle. Results cover one {terms.days}-day term, before gas; no purchases means zero premiums.</p>
        <details className="bps-method"><summary>How these estimates are calculated</summary><p className="bps-source">Median uses {result.windows} rolling {terms.days}-day windows from Ethereum Uniswap v3 WETH/USDC 0.05% base yield{result.latestDate ? `, through ${result.latestDate}` : ""}. It is a reference estimate for your {feeTier} test pool, not measured fees for these bins. Range width and the new trading fee are not used to scale historical yield.</p></details>
      </>}
    </div>
  </Card>;
}
