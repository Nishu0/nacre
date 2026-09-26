"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Card } from "@/components/ui/card";

export type OraclePoint = { timestamp: string; priceUsdc: number };

const usd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value);

const time = (timestamp: string) => new Date(timestamp).toLocaleTimeString([], {
  hour: "2-digit", minute: "2-digit", second: "2-digit",
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

export function PoolPriceChart({ points, livePrice, publishedAt, source, lower, upper, current, stale = false }: {
  points: OraclePoint[];
  livePrice?: number;
  publishedAt?: string;
  source?: string;
  lower: number;
  upper: number;
  current: number;
  stale?: boolean;
}) {
  const [windowMinutes, setWindowMinutes] = useState<1 | 5 | 60>(1);
  const plotRef = useRef<HTMLDivElement>(null);
  const [plotSize, setPlotSize] = useState({ width: 720, height: 340 });

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      setPlotSize((previous) => previous.width === width && previous.height === height
        ? previous : { width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Draw in screen pixels so labels, dots and curves keep their proportions
  // as the chart column changes width.
  const plotLeft = 8;
  const plotRight = Math.max(plotLeft + 40, plotSize.width - 86);
  const traceRight = plotRight - 22;
  const plotTop = 22;
  const plotBottom = plotSize.height - 32;
  const all = points.filter((point) => Number.isFinite(point.priceUsdc) && point.priceUsdc > 0);
  if (livePrice && publishedAt && !all.some((point) => point.timestamp === publishedAt)) {
    all.push({ timestamp: publishedAt, priceUsdc: livePrice });
  }
  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const lastObservedAt = Date.parse(all.at(-1)?.timestamp ?? "");
  const inWindow = all.filter((point) => Date.parse(point.timestamp) >= lastObservedAt - windowMinutes * 60_000);
  const windowPoints = inWindow;
  // Retain the entire selected time window, including its first and last price.
  const stride = Math.max(1, Math.ceil(windowPoints.length / 240));
  const series = windowPoints.filter((_, index) => index % stride === 0 || index === windowPoints.length - 1);
  const values = [...series.map((point) => point.priceUsdc), ...(livePrice ? [livePrice] : series.length ? [] : [current])];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = Math.max(maximum - minimum, (livePrice ?? current) * 0.00004, 0.1);
  const step = niceStep(span * 1.2 / 4);
  const axisMin = Math.floor((minimum - span * 0.1) / step) * step;
  const axisMax = Math.ceil((maximum + span * 0.1) / step) * step;
  const ticks = Array.from({ length: Math.round((axisMax - axisMin) / step) + 1 }, (_, index) => axisMin + index * step);
  const firstObservedAt = lastObservedAt - windowMinutes * 60_000;
  const shownDuration = windowMinutes * 60_000;
  const x = (index: number) => shownDuration > 0
    ? plotLeft + (Date.parse(series[index].timestamp) - firstObservedAt) / shownDuration * (traceRight - plotLeft) : traceRight;
  const y = (price: number) => plotBottom - (price - axisMin) / (axisMax - axisMin) * (plotBottom - plotTop);
  const trace = smoothPath(series.map((point, index) => ({ x: x(index), y: y(point.priceUsdc) })));
  const latest = series.at(-1);
  const liveInRange = livePrice !== undefined && livePrice >= lower && livePrice < upper;
  const freshLabel = stale ? `LAST ${source?.toUpperCase() ?? "ORACLE"} PRICE` : "LIVE ETH PERP / USDC";
  const firstTime = Number.isFinite(firstObservedAt) ? new Date(firstObservedAt).toISOString() : undefined;
  const lastTime = series.at(-1)?.timestamp;

  return <Card className="kd-card pc-card">
    <div className="kd-card-heading pc-heading"><h2><Activity size={16} /> Live price</h2><div className="pc-heading-actions"><span>{source?.toUpperCase() ?? "CONNECTING"} · ETH PERP</span><div className="pc-window-switch" role="group" aria-label="Chart time window"><button type="button" aria-pressed={windowMinutes === 1} className={windowMinutes === 1 ? "is-active" : ""} onClick={() => setWindowMinutes(1)}>1M</button><button type="button" aria-pressed={windowMinutes === 5} className={windowMinutes === 5 ? "is-active" : ""} onClick={() => setWindowMinutes(5)}>5M</button><button type="button" aria-pressed={windowMinutes === 60} className={windowMinutes === 60 ? "is-active" : ""} onClick={() => setWindowMinutes(60)}>1H</button></div></div></div>
    <div className="pc-inner">
      <div className="pc-headline">
        <div><small>{livePrice === undefined ? "CONNECTING LIVE PRICE" : freshLabel}</small>
          <strong>{livePrice === undefined ? "—" : usd(livePrice)}</strong></div>
        <span className={liveInRange ? "is-in-range" : "is-out-of-range"}>
          {livePrice === undefined ? "FEED UNAVAILABLE" : stale ? "RECONNECTING" : liveInRange ? "LIVE IN RANGE" : "LIVE OUT OF RANGE"}
        </span>
      </div>
      <div ref={plotRef} className="pc-plot" role="img" aria-label={`${source ?? "Market"} ETH perpetual recent price history: ${series.length} samples. Latest ${livePrice === undefined ? "unavailable" : usd(livePrice)}. Chart axis ${usd(axisMin)} to ${usd(axisMax)}. Selected LP range ${usd(lower)} to ${usd(upper)}.`}>
        <svg viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} aria-hidden="true">
          {ticks.map((tick) => <g key={tick}>
            <line x1={plotLeft} x2={plotRight} y1={y(tick)} y2={y(tick)} className="pc-grid-line" />
            <text x={plotRight + 12} y={y(tick) + 4} className="pc-axis-label">{usd(tick)}</text>
          </g>)}
          {livePrice !== undefined && <line x1={plotLeft} x2={plotRight} y1={y(livePrice)} y2={y(livePrice)} className="pc-current-line" />}
          {series.length > 1 && <path d={trace} className="pc-price-line" />}
          {latest && <circle cx={x(series.length - 1)} cy={y(latest.priceUsdc)} r="4" className="pc-point is-active" />}
          {firstTime && <text x={plotLeft} y={plotSize.height - 8} className="pc-time-label">{time(firstTime)}</text>}
          {lastTime && <text x={traceRight} y={plotSize.height - 8} textAnchor="end" className="pc-time-label">{time(lastTime)}</text>}
        </svg>
      </div>
    </div>
  </Card>;
}
