"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

export type PriceEvent = {
  priceUsd: number;
  tick: number;
  createdAt: string;
};

const usd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(value);

export function PoolPriceChart({ events, lower, upper, current }: {
  events: PriceEvent[];
  lower: number;
  upper: number;
  current: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const shown = events.slice(-32);
  const values = [...shown.map((event) => event.priceUsd), lower, upper, current];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max((max - min) * .16, current * .015);
  const floor = min - padding;
  const ceiling = max + padding;
  const x = (index: number) => shown.length === 1 ? 348 : 54 + index * (576 / Math.max(shown.length - 1, 1));
  const y = (price: number) => 250 - (price - floor) / (ceiling - floor) * 212;
  const points = shown.map((event, index) => `${x(index)},${y(event.priceUsd)}`).join(" ");
  const active = activeIndex === null ? shown.at(-1) : shown[activeIndex];
  const activePoint = activeIndex === null ? shown.length - 1 : activeIndex;

  return (
    <Card className="kd-card pc-card">
      <div className="kd-card-heading">
        <h2><Activity size={16} /> Price chart</h2>
        <span>RECORDED SANDBOX MOVES</span>
      </div>
      <div className="pc-inner">
        <div className="pc-headline">
          <div><small>WETH PRICE / USD</small><strong>{usd(current)}</strong></div>
          <span className={current >= lower && current < upper ? "is-in-range" : "is-out-of-range"}>
            {current >= lower && current < upper ? "IN RANGE" : "OUT OF RANGE"}
          </span>
        </div>
        <div className="pc-plot" role="img" aria-label={`${shown.length} recorded sandbox price ${shown.length === 1 ? "point" : "points"}. Current price ${usd(current)}. Selected range ${usd(lower)} to ${usd(upper)}.`}>
          <svg viewBox="0 0 720 290" preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id="pc-range-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e8f4eb" />
                <stop offset="1" stopColor="#f7fbf7" />
              </linearGradient>
            </defs>
            {[55, 108, 161, 214, 267].map((line) => <line key={line} x1="50" x2="645" y1={line} y2={line} className="pc-grid-line" />)}
            <rect x="50" y={y(upper)} width="595" height={y(lower) - y(upper)} fill="url(#pc-range-fill)" />
            <line x1="50" x2="645" y1={y(upper)} y2={y(upper)} className="pc-range-line" />
            <line x1="50" x2="645" y1={y(lower)} y2={y(lower)} className="pc-range-line" />
            <line x1="50" x2="645" y1={y(current)} y2={y(current)} className="pc-current-line" />
            {shown.length > 1 && <polyline points={points} className="pc-price-line" />}
            {shown.map((event, index) => <circle key={`${event.createdAt}-${index}`} cx={x(index)} cy={y(event.priceUsd)} r={index === activePoint ? 6 : 4} className={index === activePoint ? "pc-point is-active" : "pc-point"} onMouseEnter={() => setActiveIndex(index)} />)}
            <text x="658" y={y(upper) + 4} className="pc-axis-label">{usd(upper)}</text>
            <text x="658" y={y(lower) + 4} className="pc-axis-label">{usd(lower)}</text>
          </svg>
          <span className="pc-range-tag">SELECTED LP RANGE</span>
        </div>
        <div className="pc-chart-footer">
          <span>{shown.length === 0 ? "Loading recorded price scenarios…" : shown.length === 1 ? "Current sandbox price shown. Record a move to draw a path." : `${shown.length} recorded price scenarios · latest ${new Date(shown.at(-1)!.createdAt).toLocaleString()}`}</span>
          {active && <strong>{usd(active.priceUsd)} · tick {active.tick}</strong>}
        </div>
      </div>
    </Card>
  );
}
