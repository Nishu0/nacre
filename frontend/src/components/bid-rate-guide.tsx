"use client";
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bidGuidance, type PoolActivity } from "@/lib/bid-guidance";
import type { BidFundingTerms } from "@/lib/bid-profit";
import type { YieldDay } from "@/lib/underwriting-simulator";
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
export function useBidGuidanceData(poolId: string) {
  const [activity, setActivity] = useState<PoolActivity | null>(null);
  const [history, setHistory] = useState<YieldDay[]>([]);
  const [error, setError] = useState("");
  const [includeTest, setIncludeTest] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/workspace/pool-activity?poolId=${poolId}`, { signal: controller.signal, cache: "no-store" });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        setActivity(result); setError("");
      } catch (e) { if (!controller.signal.aborted) { setActivity(null); setError(e instanceof Error ? e.message : "Fee activity unavailable"); } }
    };
    void load(); const timer = setInterval(() => void load(), 60000);
    void fetch("/api/research/pools/usdc-weth-005/backtest?principalUsd=1000", { signal: controller.signal }).then((r) => r.json()).then((r) => { if (!controller.signal.aborted) setHistory(r.yieldHistory ?? []); }).catch(() => {});
    return () => { controller.abort(); clearInterval(timer); };
  }, [poolId]);
  return { activity, history, error, includeTest, setIncludeTest };
}
export function BidRateGuide({ terms, onChange, onRange, pricing }: {
  terms: BidFundingTerms; onChange: (terms: BidFundingTerms) => void;
  onRange: (low: number, high: number) => void; pricing: ReturnType<typeof useBidGuidanceData>;
}) {
  const { activity, history, error, includeTest, setIncludeTest } = pricing;
  const principal = terms.principal ?? "1000", cap = terms.cap ?? "10";
  const guide = bidGuidance(history, Number(principal), Number(cap), terms.days, activity, includeTest);
  return <Card className="kd-card"><div className="kd-card-heading"><h2>Pool earnings & bid guidance</h2><span>LIVE ACTIVITY</span></div><div className="mw-trade-inner">
    {activity ? <><div className="mw-underwriter-sim"><div><span>Pool fee run rate · annualized</span><strong>{activity.baseApr === null ? "No liquidity" : `${fmt(activity.baseApr)}%`}</strong></div><div><span>Excluding generated swaps</span><strong>{activity.organicApr === null ? "—" : `${fmt(activity.organicApr)}%`}</strong></div><div><span>Fees · last {fmt(activity.hours)}h</span><strong>{fmt(activity.grossFees)} nUSDC</strong></div><div><span>Current pool liquidity value</span><strong>{fmt(activity.tvl)} nUSDC</strong></div></div><small>{activity.swaps} swaps · {activity.syntheticSwaps} generated test swaps · {activity.feePct}% trading fee per swap</small>
      {!!activity.syntheticSwaps && <label><input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} /> Include generated activity in demo pricing</label>}
      <details><summary>Rate calculation</summary><p>{activity.methodology}</p></details></> : <p>{error || "Reading pool swaps and liquidity…"}</p>}
    <label className="mw-field"><span>Example investor deposit (nUSDC)</span><Input type="number" min="1" value={principal} onChange={(e) => onChange({ ...terms, principal: e.target.value })} /></label>
    {terms.quoteIssue && <p className="mw-premium-warning" role="status">{terms.quoteIssue}</p>}
    {guide ? <><div className="cw-terms"><span>Modeled {terms.days}-day LP fees: {fmt(guide.budget)} nUSDC</span><span>Historical best window: {fmt(guide.best)} nUSDC</span><strong>{guide.suggestedPct === null ? "No supported premium at this cap" : `Suggested premium: ${fmt(guide.suggestedPct)}% of cap`}</strong><span>LP affordability guide: up to {fmt(guide.affordablePct)}% of cap</span><span>Suggested fee cap: up to {fmt(guide.recommendedCap)} nUSDC per example position</span><span>Your fee floor: {fmt(Number(cap) / Number(principal) * 365 / terms.days * 100)}% annualized</span><span>Fee-supported ceiling: {fmt(guide.recommendedCap / Number(principal) * 365 / terms.days * 10000)} bps annualized</span></div>
      {(!guide.feasible || Number(terms.rate) > guide.affordablePct || Number(cap) > guide.best) && <p className="mw-premium-warning" role="status">These terms exceed the fee-supported guide. {guide.feasible ? "The premium consumes more than 20% of modeled LP fees." : "Modeled claim costs and the LP fee budget do not support a mutually profitable price."} You can still fund at your chosen terms; reduce the cap and reassess range risk.</p>}

      <small>Historical proxy: Ethereum v3 0.05%, {guide.windows} fee windows. Suggested premium = mean shortfall × 1.2 + 1% of cap. LP budget = 20% of modeled fees. Historical fee windows are scaled down when measured earnings are lower, after ≥10 swaps and ≥1h (or explicit test-activity opt-in). A specific range can earn zero.</small></> : !terms.quoteIssue && <small>Historical pricing guidance unavailable until enough fee observations load.</small>}
    {activity && <><Button variant="outline" onClick={() => { const buffer = Math.max((activity.high - activity.low) * .2, activity.price * .02); onRange(activity.low - buffer, activity.high + buffer); }}>Use observed range + buffer</Button><small>Observed {fmt(activity.low)}–{fmt(activity.high)}; buffer is 20% of observed spread or 2% of price, whichever is larger. This is a starting range, not an optimal yield forecast.</small></>}
  </div></Card>;
}
