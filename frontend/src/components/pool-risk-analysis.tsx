"use client";

import { Activity, ArrowUpRight, ExternalLink, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export type RiskReport = {
  mode: "research";
  marketId: string;
  referencePool: {
    id: string; symbol: string; feeTier: string; volumeUrl: string; yieldUrl: string;
  };
  analysis: {
    sampleFrom: string; sampleThrough: string; sampleDays: number;
    windowDays: number; windowCount: number; depositUsd: number;
    feeFloorUsd: number; payoutCapUsd: number; shortfallWindows: number;
    shortfallFrequencyPct: number; historicalAveragePayoutUsd: number;
    averagePayoutWhenShortUsd: number; worstHistoricalPayoutUsd: number;
    lowest30DayFeesUsd: number; latest30DayFeesUsd: number;
    monthly: {
      month: string; days: number; modeledFeesUsd: number; grossPoolFeesUsd: number;
      volumeUsd: number; averageTvlUsd: number; averageBaseApyPct: number;
    }[];
  };
  quote: {
    premiumUsd: number; expectedPayoutUsd: number; underwriterMarginUsd: number;
    edgeRiskPct: number; available: boolean; reasons: string[];
  };
};

const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(value);
const compactMoney = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
}).format(value);
const monthLabel = (month: string) => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", {
  month: "short", year: "2-digit", timeZone: "UTC",
});

export function PoolRiskAnalysis({ report, capacityUsd, reservedUsd }: {
  report: RiskReport; capacityUsd: number; reservedUsd: number;
}) {
  const { analysis, quote, referencePool } = report;
  const maxMonthlyFees = Math.max(1, ...analysis.monthly.map((month) => month.modeledFeesUsd));
  const unreserved = Math.max(0, capacityUsd - reservedUsd);
  const canBackSample = unreserved >= analysis.payoutCapUsd;

  return <section className="mw-risk-section" aria-label="Underwriter pool risk analysis">
    <div className="mw-risk-intro"><div><span>UNDERWRITER RESEARCH</span><h2>Pool risk analysis</h2><p>Fee evidence and capped exposure for a {money(analysis.depositUsd)} example LP position.</p></div><Badge variant="outline">{analysis.sampleDays} DAYS · {analysis.windowCount} WINDOWS</Badge></div>
    <div className="mw-risk-metrics">
      <div><span>SHORTFALL WINDOWS</span><strong>{analysis.shortfallFrequencyPct}%</strong><small>{analysis.shortfallWindows} of {analysis.windowCount} overlapping 30-day samples</small></div>
      <div><span>HISTORICAL AVG PAYOUT</span><strong>{money(analysis.historicalAveragePayoutUsd)}</strong><small>Across all sampled windows</small></div>
      <div><span>WORST SAMPLED PAYOUT</span><strong>{money(analysis.worstHistoricalPayoutUsd)}</strong><small>Full contractual cap: {money(analysis.payoutCapUsd)}</small></div>
      <div><span>INDICATIVE PREMIUM</span><strong>{money(quote.premiumUsd)}</strong><small>Modeled margin: {money(quote.underwriterMarginUsd)}</small></div>
    </div>
    <div className="mw-risk-panels">
      <Card className="kd-card mw-risk-evidence-card">
        <div className="kd-card-heading"><h2><Activity size={16} /> Monthly fee evidence</h2><span>{referencePool.symbol} · {referencePool.feeTier} V3</span></div>
        <div className="mw-risk-evidence-inner">
          <div className="mw-risk-chart-head"><div><small>MODELED POSITION FEES</small><strong>{money(analysis.latest30DayFeesUsd)}</strong><span>latest rolling 30 days</span></div><div><small>FEE FLOOR</small><strong>{money(analysis.feeFloorUsd)}</strong><span>for this example position</span></div></div>
          <div className="mw-risk-bar-chart" role="img" aria-label={`Modeled monthly position fees on ${money(analysis.depositUsd)} capital: ${analysis.monthly.map((row) => `${monthLabel(row.month)} ${money(row.modeledFeesUsd)}`).join(", ")}`}>
            {analysis.monthly.map((row) => <div key={row.month} className="mw-risk-bar-column"><div className="mw-risk-bar-track"><i style={{ height: `${Math.max(4, row.modeledFeesUsd / maxMonthlyFees * 100)}%` }} /></div><span>{monthLabel(row.month)}</span></div>)}
          </div>
          <div className="mw-risk-table-wrap"><table><thead><tr><th>MONTH</th><th>DAYS</th><th>MODELED LP FEES</th><th>GROSS POOL FEES</th><th>VOLUME</th><th>AVG TVL</th></tr></thead><tbody>{analysis.monthly.map((row) => <tr key={row.month}><td>{monthLabel(row.month)}</td><td>{row.days}</td><td>{money(row.modeledFeesUsd)}</td><td>{compactMoney(row.grossPoolFeesUsd)}</td><td>{compactMoney(row.volumeUsd)}</td><td>{compactMoney(row.averageTvlUsd)}</td></tr>)}</tbody></table></div>
        </div>
      </Card>
      <Card className="kd-card mw-risk-exposure-card">
        <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Coverage exposure</h2><span>EXAMPLE POSITION</span></div>
        <div className="mw-risk-exposure-inner">
          <div className="mw-risk-exposure-lead"><span>Maximum underwriter liability</span><strong>{money(analysis.payoutCapUsd)}</strong><small>Collateral must cover this entire cap for each policy.</small></div>
          <dl>
            <div><dt>30-day fee floor</dt><dd>{money(analysis.feeFloorUsd)}</dd></div>
            <div><dt>Lowest sampled 30-day fees</dt><dd>{money(analysis.lowest30DayFeesUsd)}</dd></div>
            <div><dt>Avg payout when short</dt><dd>{money(analysis.averagePayoutWhenShortUsd)}</dd></div>
            <div><dt>Stress-adjusted payout model</dt><dd>{money(quote.expectedPayoutUsd)}</dd></div>
            <div><dt>Range edge heuristic</dt><dd>{quote.edgeRiskPct}%</dd></div>
            <div><dt>Unreserved pool capacity</dt><dd>{money(unreserved)}</dd></div>
          </dl>
          <div className={`mw-risk-capacity${canBackSample ? " is-sufficient" : ""}`}><ArrowUpRight size={14} />{canBackSample ? "Capacity can back this example cap" : "More backing needed for this example cap"}</div>
          {!quote.available && <p className="mw-risk-conditions">Current coverage is unavailable: {quote.reasons.join(" ")}</p>}
          <p className="mw-risk-period">Historical sample: {analysis.sampleFrom} to {analysis.sampleThrough}. Monthly rows at the sample edges may contain fewer than a full month.</p>
        </div>
      </Card>
    </div>
    <p className="mw-risk-disclosure">Research only. Monthly LP fees use pool-level base APY on the example capital; they are not realized fees for this concentrated range. The shortfall share comes from overlapping windows, so it is not a calibrated probability of loss. Maximum payout may exceed every observed payout. Sources: <a href={referencePool.volumeUrl} target="_blank" rel="noreferrer">GeckoTerminal <ExternalLink size={12} /></a> and <a href={referencePool.yieldUrl} target="_blank" rel="noreferrer">DefiLlama <ExternalLink size={12} /></a>.</p>
  </section>;
}
