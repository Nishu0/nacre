"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

export type OraclePoint = { timestamp: string; priceUsdc: number };

const usd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(value);

export function PoolPriceChart({ points, livePrice, publishedAt, source, lower, upper, current }: {
  points: OraclePoint[];
  livePrice?: number;
  publishedAt?: string;
  source?: string;
  lower: number;
  upper: number;
  current: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const shown = points.slice(-120);
  const marketValues = [...shown.map((point) => point.priceUsdc), livePrice ?? current];
  const marketMin = Math.min(...marketValues);
  const marketMax = Math.max(...marketValues);
  const marketPad = Math.max((marketMax - marketMin) * .25, marketMax * .012);
  const rangeVisible = lower <= marketMax + marketPad && upper >= marketMin - marketPad;
  const values = rangeVisible ? [...marketValues, lower, upper] : marketValues;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = rangeVisible
    ? Math.max((max - min) * .12, (livePrice ?? current) * .015)
    : Math.max((max - min) * .25, (livePrice ?? current) * .001);
  const floor = min - padding;
  const ceiling = max + padding;
  const x = (index: number) => shown.length === 1 ? 348
    : 54 + index * (576 / Math.max(shown.length - 1, 1));
  const y = (price: number) => 250 - (price - floor) / (ceiling - floor) * 212;
  const path = shown.map((point, index) => `${x(index)},${y(point.priceUsdc)}`).join(" ");
  const selectedIndex = activeIndex === null ? shown.length - 1
    : Math.min(activeIndex, shown.length - 1);
  const active = shown[selectedIndex];
  const liveInRange = livePrice !== undefined && livePrice >= lower && livePrice < upper;
  const latestTime = publishedAt ? new Date(publishedAt).toLocaleTimeString() : "—";

  return <Card className="kd-card pc-card">
    <div className="kd-card-heading"><h2><Activity size={16} /> Live price</h2><span>{source?.toUpperCase() ?? "AWAITING ORACLE"} · WETH / USDC</span></div>
    <div className="pc-inner">
      <div className="pc-headline">
        <div><small>{livePrice === undefined ? "AWAITING FRESH ORACLE PRICE" : "LIVE WETH / USDC"}</small>
          <strong>{livePrice === undefined ? "—" : usd(livePrice)}</strong></div>
        <span className={liveInRange ? "is-in-range" : "is-out-of-range"}>
          {livePrice === undefined ? "ORACLE UNAVAILABLE" : liveInRange ? "LIVE IN RANGE" : "LIVE OUT OF RANGE"}
        </span>
      </div>
      <div className="pc-plot" role="img" aria-label={`Pyth WETH/USDC price history: ${shown.length} samples. Live ${livePrice === undefined ? "unavailable" : usd(livePrice)}. Selected range ${usd(lower)} to ${usd(upper)}.`}>
        <svg viewBox="0 0 720 290" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="pc-range-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8f4eb" /><stop offset="1" stopColor="#f7fbf7" /></linearGradient></defs>
          {[55, 108, 161, 214, 267].map((line) => <line key={line} x1="50" x2="645" y1={line} y2={line} className="pc-grid-line" />)}
          {rangeVisible && <><rect x="50" y={y(upper)} width="595" height={y(lower) - y(upper)} fill="url(#pc-range-fill)" />
            <line x1="50" x2="645" y1={y(upper)} y2={y(upper)} className="pc-range-line" />
            <line x1="50" x2="645" y1={y(lower)} y2={y(lower)} className="pc-range-line" /></>}
          {livePrice !== undefined && <line x1="50" x2="645" y1={y(livePrice)} y2={y(livePrice)} className="pc-current-line" />}
          {shown.length > 1 && <polyline points={path} className="pc-price-line" />}
          {shown.map((point, index) => <circle key={`${point.timestamp}-${index}`} cx={x(index)} cy={y(point.priceUsdc)} r="9" className="pc-hit-point" onMouseEnter={() => setActiveIndex(index)} />)}
          {active && <circle cx={x(selectedIndex)} cy={y(active.priceUsdc)} r="6" className="pc-point is-active" />}
          <text x="658" y={rangeVisible ? y(upper) + 4 : 55} className="pc-axis-label">{usd(rangeVisible ? upper : marketMax)}</text>
          <text x="658" y={rangeVisible ? y(lower) + 4 : 260} className="pc-axis-label">{usd(rangeVisible ? lower : marketMin)}</text>
        </svg>
        <span className="pc-range-tag">{rangeVisible ? "SELECTED LP RANGE" : upper < marketMin ? "LP RANGE BELOW LIVE MARKET" : "LP RANGE ABOVE LIVE MARKET"}</span>
      </div>
      <div className="pc-chart-footer">
        <span>{shown.length > 1 ? `Pyth hourly history + live samples · ${shown.length} points` : "Live samples will build the chart over time"}</span>
        {active && <strong>{usd(active.priceUsdc)} · {new Date(active.timestamp).toLocaleString()}</strong>}
      </div>
      <div className="pc-live-meta"><span>Oracle published {latestTime}</span><span>LP range {usd(lower)}–{usd(upper)} · sandbox tick {usd(current)}</span></div>
    </div>
  </Card>;
}
