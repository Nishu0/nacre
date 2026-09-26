import type { SingleTokenQuote } from "./swapvm";
export type SupplyReview = {
  singleToken?: SingleTokenQuote;
  account: string; marketId: string; poolId: string; token: `0x${string}`;
  symbol: string; fee: number; feeCap?: string; lower: number; upper: number;
  wethAmount: number; usdcAmount: number; total: number; premiumUnits?: string | null; premiumBps?: number; offer?: string; offerIndex?: number; durationDays?: number;
};
