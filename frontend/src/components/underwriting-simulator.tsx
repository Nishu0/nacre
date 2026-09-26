"use client";

import { useState } from "react";
import Link from "next/link";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PoolPriceChart } from "@/components/pool-price-chart";
import { useHyperliquidPrice } from "@/lib/use-hyperliquid-price";
import { simulateUnderwriting, type YieldDay } from "@/lib/underwriting-simulator";

const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const tickFor = (price: number) => Math.floor(Math.log(price / 1e12) / Math.log(1.0001) / 10) * 10;
const priceFor = (tick: number) => 1.0001 ** tick * 1e12;
const defaults = { principal: 1000, capital: 100, days: 30, cap: 5, premiumPct: 5,
  lossBudget: 20, positionLimit: 10, lpFeeBudgetPct: 10, shockPct: -15, stressWeightPct: 25 };

export function UnderwritingSimulator({ history, reference }: { history: YieldDay[]; reference: string }) {
  const { livePrices, points, liveError } = useHyperliquidPrice();
  const [inputs, setInputs] = useState(defaults);
  const [bounds, setBounds] = useState<{ lower: number; upper: number } | null>(null);
  const spot = livePrices?.wethUsdc;
  const validBounds = !bounds || (Number.isFinite(bounds.lower) && Number.isFinite(bounds.upper)
    && bounds.lower > 0 && bounds.upper > bounds.lower);
  const lowerTick = spot ? tickFor(validBounds && bounds ? bounds.lower : spot * .9) : 0;
  const upperTick = spot ? tickFor(validBounds && bounds ? bounds.upper : spot * 1.1) : 0;
  const lower = priceFor(lowerTick), upper = priceFor(upperTick);
  let result: ReturnType<typeof simulateUnderwriting> | undefined;
  let error = "";
  if (spot) {
    try {
      if (!validBounds) throw new Error("Enter a positive minimum price and a higher maximum price.");
      result = simulateUnderwriting(history, { ...inputs, spot, lower, upper });
    }
    catch (reason) { error = reason instanceof Error ? reason.message : "Check your inputs."; }
  }
  const update = (key: keyof typeof defaults, value: number) => setInputs((previous) => ({ ...previous, [key]: value }));
  const field = (key: keyof typeof defaults, label: string, min: number, max?: number, step = "any") =>
    <label className="uws-field"><span>{label}</span><Input type="number" min={min} max={max} step={step}
      value={Number.isNaN(inputs[key]) ? "" : inputs[key]}
      onChange={(event) => update(key, event.target.value === "" ? NaN : Number(event.target.value))} /></label>;
  const setBound = (key: "lower" | "upper", value: number) => {
    if (!spot) return;
    setBounds({ lower, upper, [key]: value });
  };
  const applyBalancedPremium = () => {
    if (!result?.feasible) return;
    const premiumPct = Math.ceil(result.minimumPremium / inputs.cap * 10000) / 100;
    if (inputs.cap * premiumPct / 100 <= result.lpPremiumCeiling) update("premiumPct", premiumPct);
  };
  return <section className="uws" aria-label="Underwriter coverage simulator">
    <div className="uws-title"><div><h2>Plan your coverage</h2><p>Choose bins, size your backing, and compare both sides of the same policy.</p></div><span>SIMULATION</span></div>
    {spot ? <PoolPriceChart points={points} livePrice={spot} current={spot} source="Hyperliquid" lower={lower} upper={upper}
      publishedAt={livePrices?.assets.WETH.publishedAt} stale={liveError} />
      : <div className="uws-notice" role="status">{liveError ? "Live ETH price unavailable. Reconnecting…" : "Connecting to the live ETH price…"}</div>}
    {liveError && spot && <p className="uws-notice">Feed interrupted. Results use the last received price until the connection recovers.</p>}
    <div className="uws-layout">
      <Card className="kd-card"><div className="kd-card-heading"><h2><ShieldCheck size={17} /> Coverage inputs</h2><span>PER POSITION</span></div>
        <div className="uws-body">
          <div className="uws-fields">
            {field("principal", "LP deposit (USD)", 1)}
            <label className="uws-field"><span>Coverage duration</span><select value={inputs.days} onChange={(event) => update("days", Number(event.target.value))}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
            {field("cap", "Protected fees / payout cap (USD)", .01)}
            {field("premiumPct", "Premium (% of payout cap)", 0, 100, ".01")}
          </div>
          <div className="uws-range">
            <div className="uws-title"><strong>Selected bins</strong><button type="button" disabled={!spot} onClick={() => spot && setBounds({ lower: spot * .9, upper: spot * 1.1 })}>Center on live price</button></div>
            <div className="uws-fields">{(["lower", "upper"] as const).map((key) => <label key={key} className="uws-field"><span>{key === "lower" ? "Minimum price" : "Maximum price"}</span><Input type="number" min="0.01" step=".01" disabled={!spot}
              value={bounds?.[key] ?? (spot ? Number((key === "lower" ? lower : upper).toFixed(2)) : "")}
              onChange={(event) => setBound(key, Number(event.target.value))} /></label>)}</div>
            <p><strong>Total bins: {spot && upperTick > lowerTick ? (upperTick - lowerTick) / 10 : "—"}</strong><span>{spot ? `${lowerTick} → ${upperTick} · spacing 10` : "Waiting for price"}</span></p>
            {spot && <small>Tick-aligned bounds {usd(lower)}–{usd(upper)}. {bounds ? "Bounds stay fixed as the live price moves." : "Preview follows live price until you edit or center it."}</small>}
          </div>
          <h3>Capital and loss limits</h3>
          <div className="uws-fields">
            {field("capital", "Underwriter capital (nUSDC)", 0)}
            {field("lossBudget", "Maximum total loss budget (USD)", 0)}
            {field("positionLimit", "Maximum covered positions", 0, 1000000, "1")}
            {field("lpFeeBudgetPct", "LP premium budget (% of fees)", 0, 100)}
          </div>
          <details className="uws-assumptions" open><summary>Range stress assumptions</summary><div className="uws-fields">
            {field("shockPct", "Price move over the term (%)", -99, 1000)}
            {field("stressWeightPct", "Weight given to stress (%)", 0, 100)}
          </div><p>Assumes price moves steadily from live ETH to the selected end price. Fees stop outside your bins; remaining fees receive a 20% haircut. Stress weight is your assumption, not an observed probability.</p></details>
        </div>
      </Card>
      <div className="uws-results" aria-live="polite">
        {error && <p className="uws-notice" role="alert">{error}</p>}
        {result && <>
          <Card className="kd-card"><div className="kd-card-heading"><h2>Does this work for both sides?</h2><span>{result.premiumAcceptable ? "WITHIN MODEL LIMITS" : "ADJUST TERMS"}</span></div><div className="uws-body">
            <div className="uws-rate"><span>Latest reference base APY <small>{reference} · {result.latestDate}</small></span><strong>{result.latestApy.toFixed(2)}%</strong></div>
            <p className="uws-muted">Historical pool-level yield, not a live rate for the Base Sepolia pool. At this rate, {inputs.days}-day fees on this LP size would be {usd(result.currentRunRate)}.</p>
            <dl className="uws-values">
              <div><dt>Premium per LP</dt><dd>{usd(result.premium)}</dd></div>
              <div><dt>Modeled payout per LP</dt><dd>{usd(result.expectedPayout)}</dd></div>
              <div><dt>Minimum premium with risk margin</dt><dd>{usd(result.minimumPremium)}</dd></div>
              <div><dt>Maximum within LP fee budget</dt><dd>{usd(result.lpPremiumCeiling)}</dd></div>
              <div><dt>Recent fees after premium · no claim</dt><dd>{usd(result.recent - result.premium)}</dd></div>
            </dl>
            <p className="uws-verdict">{!result.inRange ? "Live price is outside these bins. Choose a range containing the price before offering new coverage."
              : !result.capWithinLimits ? `Lower the payout cap. Research ceiling: ${usd(result.researchCap)}; indicative contract ceiling: ${usd(result.indicativeContractCap)}.`
              : !result.feasible ? "No shared premium interval under these assumptions. Lower the fee floor, widen the bins, or reassess the LP fee budget."
              : result.premiumAcceptable ? "This premium covers the modeled payout plus risk margin and stays inside the LP fee budget."
              : `Choose a premium between ${usd(result.minimumPremium)} and ${usd(result.lpPremiumCeiling)} per position.`}</p>
            <button type="button" className="uws-action" onClick={applyBalancedPremium} disabled={!result.feasible || liveError}>Use modeled minimum premium</button>
          </div></Card>
          <Card className="kd-card"><div className="kd-card-heading"><h2>Your backing plan</h2><span>ONE COVERAGE TERM</span></div><div className="uws-body">
            <div className="uws-metrics"><div><span>Positions within both limits</span><strong>{result.count}</strong></div><div><span>Worst total net loss</span><strong className="uws-loss">{usd(result.worstLoss)}</strong></div><div><span>Modeled net earnings</span><strong>{usd(result.expectedNet)}</strong></div><div><span>Premiums if all slots sell</span><strong>{usd(result.premiums)}</strong></div></div>
            <p>Capital can back {result.collateralLimit} positions. Your loss budget allows {result.riskLimit}. The plan uses the smaller limit and your chosen position maximum.</p>
            <dl className="uws-values"><div><dt>Full caps reserved</dt><dd>{usd(result.reserved)}</dd></div><div><dt>Capital kept aside</dt><dd>{usd(result.idle)}</dd></div><div><dt>Stress days inside range</dt><dd>{result.inRangeDays} / {inputs.days}</dd></div></dl>
            <p className="uws-muted">Assumes every slot sells once. Net earnings are after modeled claims, before gas. A zero-fee event can affect all positions together. Fewer positions reduce total exposure; they do not reduce loss per position.</p>
            <Link href="/dashboard/pools" className="uws-pool-link">Open pools to fund coverage <ArrowRight size={16} /></Link>
            <small>Simulation limits are not saved to an offer. Fund only the reserved amount and check the pool’s actual ticks, oracle cap, and premium before signing.</small>
          </div></Card>
        </>}
      </div>
    </div>
    {result && <Card className="kd-card"><div className="kd-card-heading"><h2>Compare the outcomes</h2><span>{result.count} FULLY BACKED POSITIONS</span></div><div className="uws-body uws-table-wrap"><table><thead><tr><th>Scenario</th><th>LP fees without cover</th><th>Payout per LP</th><th>LP net with cover</th><th>Underwriter total net</th></tr></thead><tbody>{result.scenarios.map((row) => <tr key={row.name}><td>{row.name}</td><td>{usd(row.uninsuredNet)}</td><td>{usd(row.payout)}</td><td>{usd(row.lpNet)}</td><td className={row.underwriterNet < 0 ? "uws-loss" : ""}>{usd(row.underwriterNet)}</td></tr>)}</tbody></table>
      <p className="uws-muted">Uses {result.sampleDays} yield observations and {result.windowCount} overlapping {inputs.days}-day windows. These are dependent historical samples. Minimum premium = weighted payout × 1.2 + 1% of cap. LP budget uses the lower of recent-window fees and the latest reference rate. Covers fee shortfalls only; principal loss, impermanent loss, and gas are excluded.</p>
      <p className="uws-muted">ETH perpetual price is a market reference for all selected WETH pairs; USD stablecoin parity is assumed. Range scenarios use daily samples, not historical intraday tick replay. The deployed contract may allow a lower cap after valuing the actual NFT. Settlement timing can also change eligible collected fees.</p>
    </div></Card>}
  </section>;
}
