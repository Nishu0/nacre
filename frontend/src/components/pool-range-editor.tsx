"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { priceToRawTick } from "@/lib/nacre-liquidity";
import { rangeSliderDomain, moveRangeBound, rangeTickPrice } from "@/lib/range-slider";

const format = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const percentFrom = (value: number, current: number) => `${value >= current ? "+" : ""}${((value / current - 1) * 100).toFixed(1)}% from spot`;

function PriceField({ value, side, onCommit, current, readOnly = false }: { value: number; side: "lower" | "upper"; onCommit: (value: number) => void; current: number; readOnly?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (!readOnly && draft !== null && draft.trim() && Number(draft) > 0 && Number.isFinite(Number(draft))) onCommit(Number(draft));
    setDraft(null);
  };
  return <label><span>{side === "lower" ? "MIN PRICE" : "MAX PRICE"}</span><Input aria-label={`${side === "lower" ? "Minimum" : "Maximum"} position price`} readOnly={readOnly} type="number" step="0.01" value={draft ?? (Number.isFinite(value) ? value.toFixed(2) : "")} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }} /><small>{percentFrom(value, current)}</small></label>;
}

export function PoolRangeEditor({ minimum, maximum, current, currentLabel, onChainPrice, lower, upper, onLower, onUpper, onCenter, fundedRange, locked = false }: {
  minimum: number; maximum: number; current: number; lower: number; upper: number;
  currentLabel: string; onChainPrice?: number; onCenter?: () => void;
  onLower: (value: number) => void; onUpper: (value: number) => void;
  fundedRange?: { tickLower: number; tickUpper: number; exact: boolean };
  locked?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const [dragDomain, setDragDomain] = useState<{ start: number; end: number } | null>(null);
  const limits = rangeSliderDomain(minimum, maximum, current,
    fundedRange ? rangeTickPrice(fundedRange.tickLower) : lower,
    fundedRange ? rangeTickPrice(fundedRange.tickUpper) : upper, zoom);
  const minTick = fundedRange?.tickLower ?? limits.minTick;
  const maxTick = fundedRange?.tickUpper ?? limits.maxTick;
  const readOnly = locked || !!fundedRange?.exact;
  // Freeze the axis during a gesture so the thumb never chases a changing scale.
  const domain = dragDomain ?? limits;
  const lowerTick = lower > 0 && Number.isFinite(lower) ? priceToRawTick(lower) : limits.minTick;
  const upperTick = upper > 0 && Number.isFinite(upper) ? priceToRawTick(upper) : limits.maxTick;
  const shownLower = rangeTickPrice(lowerTick), shownUpper = rangeTickPrice(upperTick);
  const position = (tick: number) => Math.max(0, Math.min(100, (tick - domain.start) / Math.max(10, domain.end - domain.start) * 100));
  const left = position(lowerTick), right = position(upperTick);
  const fundedLeft = position(minTick), fundedRight = position(maxTick);
  const spot = position(current > 0 ? Math.log(current * 1e-12) / Math.log(1.0001) : domain.start);
  const totalBins = Math.max(0, (upperTick - lowerTick) / 10);
  const change = (side: "lower" | "upper", tick: number) => {
    if (readOnly) return;
    const next = moveRangeBound(side, tick, side === "lower" ? upperTick : lowerTick, minTick, maxTick);
    (side === "lower" ? onLower : onUpper)(rangeTickPrice(next));
  };
  const center = () => {
    if (readOnly) return;
    setDragDomain(null); setZoom(1);
    if (onCenter) { onCenter(); return; }
    const tick = priceToRawTick(current);
    onLower(rangeTickPrice(Math.max(minTick, Math.min(maxTick - 10, tick - 1000))));
    onUpper(rangeTickPrice(Math.min(maxTick, Math.max(minTick + 10, tick + 1000))));
  };
  const within = current >= shownLower && current < shownUpper;
  const bars = Array.from({ length: 42 }, (_, index) => {
    const offset = index / 41;
    const height = 22 + 44 * Math.exp(-Math.pow((offset - spot / 100) * 3.2, 2)) + 12 * Math.sin(index * .85) ** 2;
    const selected = offset * 100 >= left && offset * 100 <= right;
    const funded = offset * 100 >= fundedLeft && offset * 100 <= fundedRight;
    return <span key={index} className={selected ? "is-selected" : fundedRange ? funded ? "is-funded" : "is-unfunded" : ""} style={{ height: `${height}%` }} />;
  });
  return <div className="pre-editor">
    <div className="pre-heading"><strong>Position price range</strong><div>{!readOnly && <button type="button" disabled={current <= rangeTickPrice(minTick) || current >= rangeTickPrice(maxTick)} onClick={center}>Center on price</button>}<span>{within ? "IN RANGE" : "OUT OF RANGE"}</span></div></div>
    {fundedRange && <div className="pre-legend"><span><i className="pre-key-funded" />Funded bid</span><span><i className="pre-key-selected" />Your selection</span><span><i className="pre-key-unfunded" />Outside this bid</span></div>}
    <div className="pre-chart" role="img" aria-label={`Position range ${format(shownLower)} to ${format(shownUpper)}; ${currentLabel.toLowerCase()} ${format(current)}${fundedRange ? `; funded boundaries ${format(rangeTickPrice(minTick))} to ${format(rangeTickPrice(maxTick))}` : ""}`}>
      {fundedRange && <div className="pre-funded-band" style={{ left: `${fundedLeft}%`, width: `${fundedRight - fundedLeft}%` }} />}
      <div className="pre-spot" style={{ left: `${spot}%` }}><span style={spot < 12 ? { transform: "none", left: 0 } : spot > 88 ? { transform: "translateX(-100%)", left: 0 } : undefined}>{currentLabel}<br /><strong>{format(current)}</strong></span><i /></div>
      <div className="pre-bars">{bars}</div>
      <div className="pre-selected" style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }} />
    </div>
    <div className="pre-axis"><span>{format(rangeTickPrice(domain.start))}</span><span>{format(rangeTickPrice(domain.end))}</span></div>
    {fundedRange && <div className="pre-funded-caption"><strong>Funded: {format(rangeTickPrice(minTick))} – {format(rangeTickPrice(maxTick))}</strong><span>{fundedRange.exact ? "Exact range · locked to this bid’s boundaries" : locked ? "Range selection paused · bid unavailable" : "Select within the blue boundaries. Controls stop at the funded limits."}</span></div>}
    <div className="pre-heading"><small>{readOnly ? "Price view" : "Price view · drag to update"}</small><div><button type="button" onClick={() => setZoom((z) => Math.max(.25, z / 2))} disabled={zoom <= .25}>Zoom in</button><button type="button" onClick={() => setZoom((z) => Math.min(8, z * 2))} disabled={zoom >= 8}>Zoom out</button></div></div>
    {!readOnly && <div className="pre-sliders">{(["lower", "upper"] as const).map((side) => <label key={side}><span>{side === "lower" ? "Minimum" : "Maximum"}</span><input aria-label={`${side === "lower" ? "Minimum" : "Maximum"} price slider`} aria-valuetext={format(side === "lower" ? shownLower : shownUpper)} type="range" min={fundedRange ? minTick : domain.start} max={fundedRange ? maxTick : domain.end} step={10} value={side === "lower" ? lowerTick : upperTick}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragDomain({ start: limits.start, end: limits.end }); }} onPointerUp={() => setDragDomain(null)} onPointerCancel={() => setDragDomain(null)} onBlur={() => setDragDomain(null)}
      onKeyDown={() => { if (!dragDomain) setDragDomain({ start: limits.start, end: limits.end }); }} onKeyUp={() => setDragDomain(null)}
      onChange={(e) => change(side, Number(e.target.value))} /></label>)}</div>}
    <div className="pre-fields"><PriceField side="lower" value={shownLower} current={current} readOnly={readOnly} onCommit={(value) => change("lower", priceToRawTick(value))} /><PriceField side="upper" value={shownUpper} current={current} readOnly={readOnly} onCommit={(value) => change("upper", priceToRawTick(value))} /></div>
    <div className="pre-bin-count"><span>Total bins</span><strong>{totalBins}</strong></div>
    <p>{fundedRange?.exact ? "Choose another funded bid to use different boundaries." : "Bounds snap to pool ticks with at least one bin between them."} {onChainPrice ? `Supply uses the on-chain pool price, ${format(onChainPrice)}.` : "The price view follows the current pool price; your selected bounds stay fixed."}</p>
  </div>;
}
