"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { priceToRawTick } from "@/lib/nacre-chain";

const format = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const percentFrom = (value: number, current: number) => {
  if (!current) return "";
  const percent = (value / current - 1) * 100;
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}% from spot`;
};

export function PoolRangeEditor({ minimum, maximum, current, currentLabel, onChainPrice, lower, upper, onLower, onUpper, onCenter }: {
  minimum: number; maximum: number; current: number; lower: number; upper: number;
  currentLabel: string; onChainPrice?: number; onCenter?: () => void;
  onLower: (value: number) => void; onUpper: (value: number) => void;
}) {
  const [draftLower, setDraftLower] = useState<number | null>(null);
  const [draftUpper, setDraftUpper] = useState<number | null>(null);
  const shownLower = draftLower ?? lower;
  const shownUpper = draftUpper ?? upper;
  const commitLower = () => {
    if (draftLower === null) return;
    onLower(draftLower);
    setDraftLower(null);
  };
  const commitUpper = () => {
    if (draftUpper === null) return;
    onUpper(draftUpper);
    setDraftUpper(null);
  };
  const width = Math.max(maximum - minimum, .01);
  const left = Math.max(0, Math.min(100, (shownLower - minimum) / width * 100));
  const right = Math.max(0, Math.min(100, (shownUpper - minimum) / width * 100));
  const spot = Math.max(0, Math.min(100, (current - minimum) / width * 100));
  const totalBins = Math.max(0, (priceToRawTick(shownUpper) - priceToRawTick(shownLower)) / 10);
  const bars = Array.from({ length: 42 }, (_, index) => {
    const offset = index / 41;
    const height = 22 + 44 * Math.exp(-Math.pow((offset - spot / 100) * 3.2, 2)) + 12 * Math.sin(index * .85) ** 2;
    return <span key={index} className={offset * 100 >= left && offset * 100 <= right ? "is-selected" : ""} style={{ height: `${height}%` }} />;
  });
  const within = current >= shownLower && current < shownUpper;
  return <div className="pre-editor">
    <div className="pre-heading"><strong>Position price range</strong><div>{onCenter && <button type="button" onClick={() => { setDraftLower(null); setDraftUpper(null); onCenter(); }}>Center on live</button>}<span>{within ? "IN RANGE" : "OUT OF RANGE"}</span></div></div>
    <div className="pre-chart" role="img" aria-label={`Position range ${format(shownLower)} to ${format(shownUpper)}; ${currentLabel.toLowerCase()} ${format(current)}`}>
      <div className="pre-spot" style={{ left: `${spot}%` }}><span>{currentLabel}<br /><strong>{format(current)}</strong></span><i /></div>
      <div className="pre-bars">{bars}</div>
      <div className="pre-selected" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
    </div>
    <div className="pre-axis"><span>{format(minimum)}</span><span>{format(maximum)}</span></div>
    <div className="pre-sliders"><label><span>Minimum</span><input type="range" min={minimum} max={maximum} step="0.01" value={shownLower} onChange={(event) => setDraftLower(Math.min(Number(event.target.value), shownUpper - .01))} onPointerUp={commitLower} onPointerCancel={commitLower} onKeyUp={commitLower} onBlur={commitLower} /></label><label><span>Maximum</span><input type="range" min={minimum} max={maximum} step="0.01" value={shownUpper} onChange={(event) => setDraftUpper(Math.max(Number(event.target.value), shownLower + .01))} onPointerUp={commitUpper} onPointerCancel={commitUpper} onKeyUp={commitUpper} onBlur={commitUpper} /></label></div>
    <div className="pre-fields"><label><span>MIN PRICE</span><Input aria-label="Minimum position price" type="number" min={minimum} max={shownUpper - .01} step="0.01" value={Number.isFinite(shownLower) ? shownLower : ""} onChange={(event) => { setDraftLower(null); onLower(Number(event.target.value)); }} /><small>{percentFrom(shownLower, current)}</small></label><label><span>MAX PRICE</span><Input aria-label="Maximum position price" type="number" min={shownLower + .01} max={maximum} step="0.01" value={Number.isFinite(shownUpper) ? shownUpper : ""} onChange={(event) => { setDraftUpper(null); onUpper(Number(event.target.value)); }} /><small>{percentFrom(shownUpper, current)}</small></label></div>
    <div className="pre-bin-count"><span>Total bins</span><strong>{totalBins}</strong></div>
    <p>Bounds stay within the pool’s launch range. {onChainPrice ? `Minting uses the on-chain pool price, ${format(onChainPrice)}.` : "Fee and cover estimates update after you choose a range."}</p>
  </div>;
}
