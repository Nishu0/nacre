import { priceToRawTick } from "./nacre-liquidity";
export const rangeTickPrice = (tick: number) => 1.0001 ** tick * 1e12;
export function rangeSliderDomain(minimum: number, maximum: number, current: number, lower: number, upper: number, zoom = 1) {
  const floor = priceToRawTick(minimum);
  const minTick = rangeTickPrice(floor) < minimum * (1 - 1e-12) ? floor + 10 : floor;
  const maxTick = priceToRawTick(maximum);
  const center = Math.max(minTick, Math.min(maxTick, priceToRawTick(current > 0 && Number.isFinite(current) ? current : Math.sqrt(minimum * maximum))));
  const half = Math.round(2240 * zoom / 10) * 10;
  const low = lower > 0 && Number.isFinite(lower) ? priceToRawTick(lower) : center;
  const high = upper > 0 && Number.isFinite(upper) ? priceToRawTick(upper) : center;
  return { minTick, maxTick, start: Math.max(minTick, Math.min(center - half, low - 100)), end: Math.min(maxTick, Math.max(center + half, high + 100)) };
}
export function moveRangeBound(side: "lower" | "upper", tick: number, opposite: number, minTick: number, maxTick: number) {
  const snapped = Math.round(tick / 10) * 10;
  return side === "lower" ? Math.max(minTick, Math.min(snapped, opposite - 10, maxTick - 10))
    : Math.min(maxTick, Math.max(snapped, opposite + 10, minTick + 10));
}
