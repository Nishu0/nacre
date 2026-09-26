"use client";

import { Input } from "@/components/ui/input";

const format = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);

export function PoolRangeEditor({ minimum, maximum, current, lower, upper, onLower, onUpper }: {
  minimum: number; maximum: number; current: number; lower: number; upper: number;
  onLower: (value: number) => void; onUpper: (value: number) => void;
}) {
  const width = Math.max(maximum - minimum, .01);
  const left = Math.max(0, Math.min(100, (lower - minimum) / width * 100));
  const right = Math.max(0, Math.min(100, (upper - minimum) / width * 100));
  const spot = Math.max(0, Math.min(100, (current - minimum) / width * 100));
  const bars = Array.from({ length: 42 }, (_, index) => {
    const offset = index / 41;
    const height = 22 + 44 * Math.exp(-Math.pow((offset - spot / 100) * 3.2, 2)) + 12 * Math.sin(index * .85) ** 2;
    return <span key={index} className={offset * 100 >= left && offset * 100 <= right ? "is-selected" : ""} style={{ height: `${height}%` }} />;
  });
  const within = current >= lower && current < upper;
  return <div className="pre-editor">
    <div className="pre-heading"><strong>Position price range</strong><span>{within ? "IN RANGE" : "OUT OF RANGE"}</span></div>
    <div className="pre-chart" role="img" aria-label={`Position range ${format(lower)} to ${format(upper)}; current price ${format(current)}`}>
      <div className="pre-spot" style={{ left: `${spot}%` }}><span>POOL PRICE<br /><strong>{format(current)}</strong></span><i /></div>
      <div className="pre-bars">{bars}</div>
      <div className="pre-selected" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
    </div>
    <div className="pre-axis"><span>{format(minimum)}</span><span>{format(maximum)}</span></div>
    <div className="pre-sliders"><label><span>Minimum</span><input type="range" min={minimum} max={maximum} step="0.01" value={lower} onChange={(event) => onLower(Math.min(Number(event.target.value), upper - .01))} /></label><label><span>Maximum</span><input type="range" min={minimum} max={maximum} step="0.01" value={upper} onChange={(event) => onUpper(Math.max(Number(event.target.value), lower + .01))} /></label></div>
    <div className="pre-fields"><label><span>MIN PRICE</span><Input aria-label="Minimum position price" type="number" min={minimum} max={upper - .01} step="0.01" value={Number.isFinite(lower) ? lower : ""} onChange={(event) => onLower(Number(event.target.value))} /><small>{current ? `${((lower / current - 1) * 100).toFixed(1)}% from spot` : ""}</small></label><label><span>MAX PRICE</span><Input aria-label="Maximum position price" type="number" min={lower + .01} max={maximum} step="0.01" value={Number.isFinite(upper) ? upper : ""} onChange={(event) => onUpper(Number(event.target.value))} /><small>{current ? `+${((upper / current - 1) * 100).toFixed(1)}% from spot` : ""}</small></label></div>
    <p>Selected bounds stay within this pool’s launch range. Fee and cover estimates update for the selected ticks.</p>
  </div>;
}
