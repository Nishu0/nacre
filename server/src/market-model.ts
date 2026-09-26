import { testPool } from "../../frontend/src/lib/test-pools";
import type { Database } from "bun:sqlite";
import { getObservations } from "./db";
import { rollingWindows, roundUsd } from "./backtest";

export type MarketRow = {
  id: string; creator: string; reference_pool_id: string; price_usd: number;
  lower_price_usd: number; upper_price_usd: number; tick: number;
  tick_lower: number; tick_upper: number; liquidity_target_usd: number;
  collateral_budget_usd: number; created_at: string;
};
export type PositionRow = {
  id: string; market_id: string; participant: string; deposit_usd: number;
  insured: number; floor_usd: number; premium_usd: number;
  payout_cap_usd: number; created_at: string;
  lower_price_usd: number | null; upper_price_usd: number | null;
};

const LOG_TICK = Math.log(1.0001);
const MIN_TICK = -887272;
const MAX_TICK = 887272;
export const VALID_REFERENCE = "usdc-weth-005";

export function priceToTick(price: number, spacing = 10): number {
  if (!Number.isFinite(price) || price <= 0) throw new Error("Price must be positive");
  return Math.max(MIN_TICK, Math.min(MAX_TICK, Math.floor(Math.log(price) / LOG_TICK / spacing) * spacing));
}

export function tokenSplit(price: number, lower: number, upper: number, capital: number) {
  // Token0 is WETH and token1 is USDC. The ratio follows v3/v4 liquidity math.
  const p = Math.sqrt(price), a = Math.sqrt(lower), b = Math.sqrt(upper);
  const clamped = Math.max(a, Math.min(b, p));
  const ethPerLiquidity = (b - clamped) / (clamped * b);
  const usdcPerLiquidity = clamped - a;
  const liquidity = capital / (ethPerLiquidity * price + usdcPerLiquidity);
  const ethAmount = liquidity * ethPerLiquidity;
  const usdcAmount = liquidity * usdcPerLiquidity;
  return {
    ethAmount: Math.round(ethAmount * 1e8) / 1e8,
    usdcAmount: roundUsd(usdcAmount),
    swapUsd: roundUsd(ethAmount * price),
    ethPercent: Math.round(ethAmount * price / capital * 1000) / 10,
  };
}

function sums(db: Database, marketId: string) {
  const pledged = db.query("SELECT COALESCE(SUM(capacity_usd), 0) AS amount FROM market_pledges WHERE market_id = ?")
    .get(marketId) as { amount: number };
  const invested = db.query("SELECT COALESCE(SUM(deposit_usd), 0) AS amount, COALESCE(SUM(payout_cap_usd), 0) AS reserved FROM market_positions WHERE market_id = ?")
    .get(marketId) as { amount: number; reserved: number };
  return { pledgedUsd: roundUsd(pledged.amount), investedUsd: roundUsd(invested.amount), reservedUsd: roundUsd(invested.reserved) };
}

export function presentMarket(db: Database, row: MarketRow) {
  const totals = sums(db, row.id);
  const deployment = db.query("SELECT tx_hash, pool_id, deployed_at FROM market_deployments WHERE market_id = ?")
    .get(row.id) as { tx_hash: string; pool_id: string; deployed_at: string } | null;
  const inRange = row.tick >= row.tick_lower && row.tick < row.tick_upper;
  const funded = totals.investedUsd >= row.liquidity_target_usd
    && totals.pledgedUsd >= row.collateral_budget_usd;
  return {
    archived: Boolean(db.query("SELECT 1 FROM market_archives WHERE market_id = ?").get(row.id)),
    id: row.id, creator: row.creator, referencePoolId: row.reference_pool_id,
    pair: `${testPool(deployment?.pool_id)?.symbol ?? "WETH"} / nUSDC`, feeTier: "0.05%", priceUsd: row.price_usd,
    lowerPriceUsd: row.lower_price_usd, upperPriceUsd: row.upper_price_usd,
    currentTick: row.tick, tickLower: row.tick_lower, tickUpper: row.tick_upper,
    liquidityTargetUsd: row.liquidity_target_usd,
    collateralBudgetUsd: row.collateral_budget_usd, ...totals,
    coverRemainingUsd: roundUsd(Math.max(0, totals.pledgedUsd - totals.reservedUsd)),
    inRange, funded, status: deployment ? "deployed" : !inRange ? "out_of_range" : funded ? "funded" : "funding",
    deployment: deployment ? { txHash: deployment.tx_hash, poolId: deployment.pool_id, deployedAt: deployment.deployed_at } : null,
    createdAt: row.created_at,
    mode: "sandbox" as const,
  };
}

export function quotePosition(db: Database, row: MarketRow, depositUsd: number,
  lowerPriceUsd = row.lower_price_usd, upperPriceUsd = row.upper_price_usd) {
  const market = presentMarket(db, row);
  const tickLower = priceToTick(lowerPriceUsd);
  const tickUpper = priceToTick(upperPriceUsd);
  const split = tokenSplit(row.price_usd, lowerPriceUsd, upperPriceUsd, depositUsd);
  const windows = rollingWindows(getObservations(db, VALID_REFERENCE), depositUsd);
  const fees = windows.map((window) => window.feesUsd);
  const recent = fees.at(-1) ?? 0;
  const best = Math.max(...fees);
  // Protect a conservative portion of expected fees, with an explicit per-position cap.
  const floor = Math.min(recent * 0.85, best * 0.9);
  const cap = Math.min(floor, depositUsd * 0.1);
  const distanceToEdge = Math.min(row.tick - tickLower, tickUpper - row.tick);
  const halfWidth = (tickUpper - tickLower) / 2;
  const edgeRisk = 1 - Math.max(0, Math.min(1, distanceToEdge / halfWidth));
  const shortfalls = fees.map((fee) => Math.min(cap, Math.max(0, floor - fee)));
  const stressed = fees.map((fee) => Math.min(cap, Math.max(0, floor - fee * (0.8 - edgeRisk * 0.2))));
  const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const expectedPayout = average(shortfalls) * 0.75 + average(stressed) * 0.25;
  const capitalCharge = cap * (0.01 + edgeRisk * 0.005);
  const premium = expectedPayout * (1.2 + edgeRisk * 0.25) + capitalCharge;
  const lpAlternative = depositUsd * 0.06 * 30 / 365;
  const underwriterMargin = premium - expectedPayout - capitalCharge;
  const reasons: string[] = [];
  if (!market.inRange) reasons.push("Current tick is outside this position's range.");
  if (row.tick < tickLower || row.tick >= tickUpper) reasons.push("The selected LP range does not contain the current tick.");
  if (!market.funded) reasons.push("Pool liquidity and protection capacity are still funding.");
  if (market.coverRemainingUsd + 0.001 < cap) reasons.push("Backed coverage capacity is exhausted.");
  if (floor - premium <= lpAlternative) reasons.push("Net protected fees do not clear the 6% annualized comparison rate.");
  if (underwriterMargin <= 0) reasons.push("Modeled premium does not clear the underwriter risk charge.");
  return {
    depositUsd, lowerPriceUsd, upperPriceUsd, tickLower, tickUpper,
    split, feeFloorUsd: roundUsd(floor), payoutCapUsd: roundUsd(cap),
    premiumUsd: roundUsd(premium), expectedPayoutUsd: roundUsd(expectedPayout),
    underwriterMarginUsd: roundUsd(underwriterMargin),
    edgeRiskPct: Math.round(edgeRisk * 100),
    minimumNetFeesUsd: roundUsd(floor - premium),
    alternative30DayUsd: roundUsd(lpAlternative),
    available: reasons.length === 0, reasons,
    mode: "sandbox" as const,
  };
}

export function getMarket(db: Database, id: string): MarketRow | null {
  return db.query("SELECT * FROM market_drafts WHERE id = ?").get(id) as MarketRow | null;
}

export function listMarkets(db: Database) {
  const rows = db.query("SELECT * FROM market_drafts WHERE id NOT IN (SELECT market_id FROM market_archives) ORDER BY created_at DESC").all() as MarketRow[];
  return rows.map((row) => presentMarket(db, row));
}

export function listPositions(db: Database, participant: string) {
  const rows = db.query("SELECT * FROM market_positions WHERE participant = ? ORDER BY created_at DESC")
    .all(participant) as PositionRow[];
  return rows.map((row) => ({
    id: row.id, marketId: row.market_id, participant: row.participant,
    depositUsd: row.deposit_usd, insured: Boolean(row.insured),
    feeFloorUsd: row.floor_usd, premiumUsd: row.premium_usd,
    payoutCapUsd: row.payout_cap_usd, createdAt: row.created_at,
    lowerPriceUsd: row.lower_price_usd, upperPriceUsd: row.upper_price_usd,
    mode: "sandbox" as const,
  }));
}
