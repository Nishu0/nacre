import type { Metadata } from "next";
import { NacreDashboard } from "@/components/nacre-dashboard";

export const metadata: Metadata = { title: "Fee backtest — Nacre", description: "Backtest historical Uniswap pool fee windows." };
const poolIds = new Set(["usdc-weth-005", "wbtc-weth-005", "usdc-usdt-001"]);

export default async function BacktestPage({ searchParams }: { searchParams: Promise<{ pool?: string }> }) {
  const { pool } = await searchParams;
  return <NacreDashboard view="backtest" initialPoolId={pool && poolIds.has(pool) ? pool : undefined} />;
}
