"use client";

import { useState } from "react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

export type OraclePoint = { timestamp: string; priceUsdc: number };

const usd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

const time = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], {
  hour: "2-digit", minute: "2-digit",
});

function niceStep(raw: number) {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const scaled = raw / magnitude;
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= scaled) ?? 10;
  return step * magnitude;
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";
  const slopes = points.slice(1).map((point, index) =>
    (point.y - points[index].y) / (point.x - points[index].x));
  const tangents = points.map((_, index) => {
    if (index === 0) return slopes[0];
    if (index === points.length - 1) return slopes.at(-1)!;
    const before = slopes[index - 1];
    const after = slopes[index];
    return before * after <= 0 ? 0 : Math.sign(before) * Math.min(Math.abs(before), Math.abs(after));
  });
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const width = (point.x - previous.x) / 3;
    return `${path} C ${previous.x + width} ${previous.y + tangents[index] * width}, ${point.x - width} ${point.y - tangents[index + 1] * width}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

export function PoolPriceChart({ points, livePrice, publishedAt, source, lower, upper, current, currentLabel, stale = false }: {
  points: OraclePoint[];
  livePrice?: number;
  publishedAt?: string;
  source?: string;
  lower: number;
  upper: number;
  current: number;
  currentLabel: string;
  stale?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [windowMinutes, setWindowMinutes] = useState<5 | 60>(5);
  const all = points.filter((point) => Number.isFinite(point.priceUsdc) && point.priceUsdc > 0);
  if (livePrice && publishedAt && !all.some((point) => point.timestamp === publishedAt)) {
    all.push({ timestamp: publishedAt, priceUsdc: livePrice });
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lastObservedAt = Date.parse(all.at(-1)?.timestamp ?? "");
  const inWindow = all.filter((point) => Date.parse(point.timestamp) >= lastObservedAt - windowMinutes * 60_000);
  const series = (inWindow.length >= 2 ? inWindow : all.slice(-24)).slice(-120);
  const windowLabel = inWindow.length >= 2 ? `${windowMinutes} MIN` : "RECENT";
  const values = [...series.map((point) => point.priceUsdc), ...(livePrice ? [livePrice] : series.length ? [] : [current])];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, (livePrice ?? current) * 0.00004, 0.1);
  const step = niceStep(span * 1.2 / 4);
  const axisMin = Math.floor((minimum - span * 0.1) / step) * step;
  const axisMax = Math.ceil((maximum + span * 0.1) / step) * step;
  const ticks = Array.from({ length: Math.round((axisMax - axisMin) / step) + 1 }, (_, index) => axisMin + index * step);
  const firstObservedAt = Date.parse(series[0]?.timestamp ?? "");
  const shownDuration = lastObservedAt - firstObservedAt;
  const x = (index: number) => shownDuration > 0
    ? 42 + (Date.parse(series[index].timestamp) - firstObservedAt) / shownDuration * 588 : 630;
  const y = (price: number) => 252 - (price - axisMin) / (axisMax - axisMin) * 205;
  const trace = smoothPath(series.map((point, index) => ({ x: x(index), y: y(point.priceUsdc) })));
  const selectedIndex = activeIndex === null ? series.length - 1
    : Math.min(activeIndex, series.length - 1);
  const active = series[selectedIndex];
  const liveInRange = livePrice !== undefined && livePrice >= lower && livePrice < upper;
  const latestTime = publishedAt ? time(publishedAt) : "—";
  const rangeTop = Math.max(axisMin, Math.min(axisMax, upper));
  const rangeBottom = Math.max(axisMin, Math.min(axisMax, lower));
  const hasRangeBand = rangeTop > rangeBottom;
  const freshLabel = stale ? "LAST PYTH PRICE" : "LIVE WETH / USDC";
  const firstTime = series[0]?.timestamp;
  const lastTime = series.at(-1)?.timestamp;

  return <Card className="kd-card pc-card">
    <div className="kd-card-heading pc-heading"><h2><Activity size={16} /> Live price</h2><div className="pc-heading-actions"><span>{source?.toUpperCase() ?? "AWAITING ORACLE"} · WETH / USDC</span><div className="pc-window-switch" role="group" aria-label="Chart time window"><button type="button" aria-pressed={windowMinutes === 5} className={windowMinutes === 5 ? "is-active" : ""} onClick={() => { setWindowMinutes(5); setActiveIndex(null); }}>5M</button><button type="button" aria-pressed={windowMinutes === 60} className={windowMinutes === 60 ? "is-active" : ""} onClick={() => { setWindowMinutes(60); setActiveIndex(null); }}>1H</button></div></div></div>
    <div className="pc-inner">
      <div className="pc-headline">
        <div><small>{livePrice === undefined ? "AWAITING FRESH ORACLE PRICE" : freshLabel}</small>
          <strong>{livePrice === undefined ? "—" : usd(livePrice)}</strong></div>
        <span className={liveInRange ? "is-in-range" : "is-out-of-range"}>
          {livePrice === undefined ? "ORACLE UNAVAILABLE" : stale ? "WAITING FOR ORACLE" : liveInRange ? "LIVE IN RANGE" : "LIVE OUT OF RANGE"}
        </span>
      </div>
      <div className="pc-plot" role="img" aria-label={`Pyth WETH/USDC recent price history: ${series.length} samples. Latest ${livePrice === undefined ? "unavailable" : usd(livePrice)}. Chart axis ${usd(axisMin)} to ${usd(axisMax)}. Selected LP range ${usd(lower)} to ${usd(upper)}.`}>
        <svg viewBox="0 0 720 290" preserveAspectRatio="none" aria-hidden="true" onMouseLeave={() => setActiveIndex(null)}>
          <defs><linearGradient id="pc-range-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8f4eb" /><stop offset="1" stopColor="#f7fbf7" /></linearGradient></defs>
          {hasRangeBand && <rect x="42" y={y(rangeTop)} width="588" height={y(rangeBottom) - y(rangeTop)} fill="url(#pc-range-fill)" />}
          {ticks.map((tick) => <g key={tick}>
            <line x1="42" x2="638" y1={y(tick)} y2={y(tick)} className="pc-grid-line" />
            <text x="649" y={y(tick) + 4} className="pc-axis-label">{usd(tick)}</text>
          </g>)}
          {[lower, upper].filter((bound) => bound > axisMin && bound < axisMax).map((bound) =>
            <line key={bound} x1="42" x2="638" y1={y(bound)} y2={y(bound)} className="pc-range-line" />)}
          {livePrice !== undefined && <line x1="42" x2="638" y1={y(livePrice)} y2={y(livePrice)} className="pc-current-line" />}
          {series.length > 1 && <path key={lastTime} d={trace} className="pc-price-line" />}
          {series.map((point, index) => <circle key={`${point.timestamp}-${index}`} cx={x(index)} cy={y(point.priceUsdc)} r="8" className="pc-hit-point" onMouseEnter={() => setActiveIndex(index)} />)}
          {active && <><circle cx={x(selectedIndex)} cy={y(active.priceUsdc)} r="10" className={activeIndex === null ? "pc-point-halo is-live" : "pc-point-halo"} />
            <circle cx={x(selectedIndex)} cy={y(active.priceUsdc)} r="5" className="pc-point is-active" /></>}
          {firstTime && <text x="42" y="281" className="pc-time-label">{time(firstTime)}</text>}
          {lastTime && <text x="630" y="281" textAnchor="end" className="pc-time-label">{time(lastTime)}</text>}
        </svg>
        <span className="pc-range-tag">{windowLabel} PYTH PRICE · LP RANGE {usd(lower)}–{usd(upper)}</span>
      </div>
      <div className="pc-chart-footer">
        <span>{series.length > 1 ? `${series.length} observed prices · refreshed every 15 seconds` : "Live samples will build the chart over time"}</span>
        {active && <strong>{usd(active.priceUsdc)} · {new Date(active.timestamp).toLocaleString()}</strong>}
      </div>
      <div className="pc-live-meta"><span>{stale ? "Oracle refresh delayed" : `Oracle published ${latestTime}`}</span><span>LP range {usd(lower)}–{usd(upper)} · {currentLabel} {usd(current)}</span></div>
    </div>
  </Card>;
}
