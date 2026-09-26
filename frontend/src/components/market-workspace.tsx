"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, CircleHelp, Droplets, PiggyBank, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { PoolPriceChart, type PriceEvent } from "@/components/pool-price-chart";

export type WorkspaceRole = "lp" | "underwriter";

type Market = {
  id: string; pair: string; feeTier: string; priceUsd: number; lowerPriceUsd: number;
  upperPriceUsd: number; currentTick: number; tickLower: number; tickUpper: number;
  liquidityTargetUsd: number; collateralBudgetUsd: number; investedUsd: number;
  pledgedUsd: number; reservedUsd: number; coverRemainingUsd: number;
  funded: boolean; inRange: boolean; status: string;
};
type Quote = {
  depositUsd: number; split: { ethAmount: number; usdcAmount: number; swapUsd: number; ethPercent: number };
  feeFloorUsd: number; payoutCapUsd: number; premiumUsd: number; expectedPayoutUsd: number;
  underwriterMarginUsd: number; minimumNetFeesUsd: number; alternative30DayUsd: number;
  edgeRiskPct: number;
  available: boolean; reasons: string[];
};
type Position = {
  id: string; marketId: string; depositUsd: number; insured: boolean;
  feeFloorUsd: number; premiumUsd: number; payoutCapUsd: number; createdAt: string;
};
type Pledge = { id: string; marketId: string; capacityUsd: number; createdAt: string };
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

async function api<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`/api/workspace/${path}`, {
    method, cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Workspace request failed");
  return data;
}

function useParticipant() {
  const [participant, setParticipant] = useState("");
  useEffect(() => {
    let id = localStorage.getItem("nacre-sandbox-participant");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("nacre-sandbox-participant", id); }
    queueMicrotask(() => setParticipant(id));
  }, []);
  return participant;
}

function AmountField({ label, value, onChange, min = 0 }: {
  label: string; value: string; onChange: (value: string) => void; min?: number;
}) {
  return <label className="mw-field"><span>{label}</span><Input type="number" inputMode="decimal" min={min} step="any" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspacePools({ marketId, role, onRoleChange }: { marketId?: string; role: WorkspaceRole; onRoleChange: (role: WorkspaceRole) => void }) {
  const router = useRouter();
  const participant = useParticipant();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [priceEvents, setPriceEvents] = useState<PriceEvent[]>([]);
  const [selectedId, setSelectedId] = useState(marketId ?? "");
  const [quoteState, setQuoteState] = useState<{ marketId: string; data: Quote } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [price, setPrice] = useState("2000");
  const [lower, setLower] = useState("1800");
  const [upper, setUpper] = useState("2200");
  const [target, setTarget] = useState("1000");
  const [budget, setBudget] = useState("100");
  const [deposit, setDeposit] = useState("1000");
  const [pledge, setPledge] = useState("100");
  const [simulatedPrice, setSimulatedPrice] = useState("");
  const selected = markets.find((market) => market.id === selectedId);
  const quote = quoteState?.marketId === selectedId && quoteState.data.depositUsd === Number(deposit)
    ? quoteState.data : null;

  useEffect(() => {
    const controller = new AbortController();
    void api<{ markets: Market[] }>("markets").then(({ markets: rows }) => {
      if (controller.signal.aborted) return;
      setMarkets(rows);
      setSelectedId((current) => marketId || current || rows[0]?.id || "");
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [refreshKey, marketId]);

  useEffect(() => {
    if (!marketId || !selectedId) return;
    let active = true;
    void api<{ events: PriceEvent[] }>(`markets/${selectedId}/price-history`)
      .then(({ events }) => { if (active) setPriceEvents(events); })
      .catch(() => { if (active) setPriceEvents([]); });
    return () => { active = false; };
  }, [marketId, selectedId, refreshKey]);

  useEffect(() => {
    if (!marketId || !selectedId || !Number(deposit)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void api<{ quote: Quote }>(`markets/${selectedId}/quote?depositUsd=${encodeURIComponent(deposit)}`)
        .then((data) => { if (!controller.signal.aborted) setQuoteState({ marketId: selectedId, data: data.quote }); })
        .catch(() => { if (!controller.signal.aborted) setQuoteState(null); });
    }, 180);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [marketId, selectedId, deposit, refreshKey]);

  async function change<T>(request: () => Promise<T>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await request(); setNotice(success); setRefreshKey((n) => n + 1); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed"); return null; }
    finally { setBusy(false); }
  }

  async function createMarket() {
    if (!participant) return;
    const result = await change(() => api<{ market: Market }>("markets", "POST", {
      creator: participant, priceUsd: Number(price), lowerPriceUsd: Number(lower),
      upperPriceUsd: Number(upper), liquidityTargetUsd: Number(target),
      collateralBudgetUsd: Number(budget),
    }), "Pool draft created. Invite LPs and underwriters to fund it.");
    if (result) { setCreating(false); router.push(`/dashboard/pools/${result.market.id}`); }
  }

  async function pledgeCapacity() {
    if (!selected || !participant) return;
    await change(() => api(`markets/${selected.id}/pledges`, "POST", {
      participant, amountUsd: Number(pledge),
    }), "Sandbox underwriting interest recorded. No USDC was locked.");
  }

  async function invest(requestCover: boolean) {
    if (!selected || !participant) return;
    await change(() => api(`markets/${selected.id}/positions`, "POST", {
      participant, amountUsd: Number(deposit), requestCover,
    }), requestCover ? "Covered sandbox position created." : "Sandbox LP position created.");
  }

  async function movePrice() {
    if (!selected) return;
    await change(() => api(`markets/${selected.id}/price`, "PATCH", {
      priceUsd: Number(simulatedPrice),
    }), "Sandbox tick updated. New coverage availability has been recalculated.");
  }

  return <div className="mw-page">
    <div className="mw-banner"><CircleHelp size={16} /><p><strong>Interactive sandbox</strong> · Pool funding, deposits, price moves, and coverage are saved locally by the Bun server. No tokens move and no policy is active on-chain.</p></div>
    <div className="mw-heading"><div>{marketId && <Link className="mw-back-link" href="/dashboard/pools">← All pools</Link>}{marketId && selected ? <div className="mw-title-with-icon"><TokenPairIcon pair={selected.pair} size="large" /><h2>{selected.pair}</h2></div> : <h2>{marketId ? "Pool details" : "Pool directory"}</h2>}<p>{marketId ? "Review funding, range, and available protection before joining." : "Explore funded markets, then open a pool to provide liquidity or underwrite."}</p></div>{!marketId && <Button className="kd-apply-button" onClick={() => setCreating(!creating)}><Plus size={15} /> Create pool</Button>}</div>
    {creating && !marketId && <Card className="kd-card mw-form-card"><div className="kd-card-heading"><h2><Droplets size={16} /> New pool draft</h2><Badge variant="outline">WETH / USDC · 0.05%</Badge></div><div className="mw-form-inner"><div className="mw-fields"><AmountField label="Current ETH price (USD)" value={price} onChange={setPrice} min={1} /><AmountField label="Lower range price" value={lower} onChange={setLower} min={1} /><AmountField label="Upper range price" value={upper} onChange={setUpper} min={1} /><AmountField label="LP funding target (USD)" value={target} onChange={setTarget} min={100} /><AmountField label="Protection capacity target (USD)" value={budget} onChange={setBudget} min={1} /></div><p>Price and ticks are sandbox inputs. A real v4 pool must use the deployed hook and an independent price feed.</p><Button className="kd-apply-button" disabled={busy || !participant} onClick={createMarket}>Create draft <ArrowRight size={15} /></Button></div></Card>}
    {error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    {!marketId && !markets.length && !creating && <Card className="kd-card kd-empty-panel"><div className="kd-empty-panel-inner"><div className="kd-empty-art"><Droplets size={28} strokeWidth={1.4} /></div><Badge variant="outline">POOL DIRECTORY</Badge><h2>No Nacre pool drafts yet</h2><p>Create a sandbox market to test liquidity funding, underwriting interest, tick movement, and limited cover.</p><Button className="kd-apply-button" onClick={() => setCreating(true)}><Plus size={15} /> Create first pool</Button></div></Card>}
    {!marketId && !!markets.length && <><div className="mw-directory-summary"><span>MARKETS <strong>{markets.length}</strong></span><span>LP CAPITAL <strong>{usd(markets.reduce((sum, market) => sum + market.investedUsd, 0))}</strong></span><span>AVAILABLE COVER <strong>{usd(markets.reduce((sum, market) => sum + market.coverRemainingUsd, 0))}</strong></span></div><div className="mw-directory-header"><h3>Available markets</h3><span>LOCAL SANDBOX · WETH / USDC</span></div><div className="mw-directory-grid">{markets.map((market) => <Link key={market.id} href={`/dashboard/pools/${market.id}`} className="mw-directory-card"><div className="mw-directory-top"><TokenPairIcon pair={market.pair} size="large" /><Badge variant="outline">{market.status.replaceAll("_", " ")}</Badge></div><div><h3>{market.pair}</h3><p>{market.feeTier} fee · {usd(market.priceUsd)} / ETH</p></div><div className="mw-directory-metrics"><div><span>LP funded</span><strong>{usd(market.investedUsd)}</strong><small>of {usd(market.liquidityTargetUsd)}</small></div><div><span>Cover left</span><strong>{usd(market.coverRemainingUsd)}</strong><small>{usd(market.pledgedUsd)} pledged</small></div></div><div className="mw-directory-progress"><span>Liquidity funding</span><progress max={market.liquidityTargetUsd} value={market.investedUsd} /></div><div className="mw-directory-open">View pool <ArrowRight size={15} /></div></Link>)}</div></>}
    {marketId && !selected && !!markets.length && <Card className="kd-card mw-missing"><h3>Pool not found</h3><p>This market may have been removed from the local sandbox.</p><Link href="/dashboard/pools">Back to pool directory <ArrowRight size={15} /></Link></Card>}
    {marketId && selected && <div className="mw-market-layout">
      <aside className="mw-market-sidebar" aria-label="Pool summary">
        <Card className="kd-card mw-market-overview">
          <div className="kd-card-heading"><h2>Pool overview</h2><Badge variant="outline">{selected.feeTier} FEE</Badge></div>
          <div className="mw-market-overview-inner">
            <div className="mw-overview-pair"><TokenPairIcon pair={selected.pair} size="large" /><div><strong>{selected.pair}</strong><span>V4 CONCEPT · SANDBOX</span></div></div>
            <div className="mw-overview-price"><span>Current pool price</span><strong>{usd(selected.priceUsd)}</strong><small>per WETH · tick {selected.currentTick}</small></div>
            <div className="mw-overview-row"><span>LP capital</span><strong>{usd(selected.investedUsd)}</strong></div>
            <div className="mw-overview-row"><span>Protection pledged</span><strong>{usd(selected.pledgedUsd)}</strong></div>
            <div className="mw-overview-row"><span>Cover available</span><strong>{usd(selected.coverRemainingUsd)}</strong></div>
          </div>
        </Card>
        <Card className="kd-card mw-market-overview">
          <div className="kd-card-heading"><h2><Activity size={15} /> Selected range</h2></div>
          <div className="mw-range-summary">
            <div><span>MIN PRICE</span><strong>{usd(selected.lowerPriceUsd)}</strong></div>
            <div><span>MAX PRICE</span><strong>{usd(selected.upperPriceUsd)}</strong></div>
            <div className="mw-range-track"><i style={{ left: `${Math.max(0, Math.min(100, (selected.priceUsd - selected.lowerPriceUsd) / (selected.upperPriceUsd - selected.lowerPriceUsd) * 100))}%` }} /></div>
            <p>New coverage is unavailable outside ticks {selected.tickLower}–{selected.tickUpper}.</p>
          </div>
        </Card>
      </aside>
      <section className="mw-market-center" aria-label="Price and funding">
        <PoolPriceChart events={priceEvents} lower={selected.lowerPriceUsd} upper={selected.upperPriceUsd} current={selected.priceUsd} />
        <Card className="kd-card mw-funding-card">
          <div className="kd-card-heading"><h2><Droplets size={16} /> Launch funding</h2><Badge variant="outline">{selected.funded ? "BOTH SIDES FUNDED" : "FUNDING IN PROGRESS"}</Badge></div>
          <div className="mw-funding-inner">
            <div><span>LP liquidity</span><strong>{usd(selected.investedUsd)} <small>/ {usd(selected.liquidityTargetUsd)}</small></strong><progress value={selected.investedUsd} max={selected.liquidityTargetUsd} /></div>
            <div><span>Underwriter capacity</span><strong>{usd(selected.pledgedUsd)} <small>/ {usd(selected.collateralBudgetUsd)}</small></strong><progress value={selected.pledgedUsd} max={selected.collateralBudgetUsd} /></div>
            <p>A pool opens when both liquidity and protection are funded. Each covered position reserves its own payout cap.</p>
          </div>
        </Card>
      </section>
      <aside className="mw-market-actions" aria-label="Pool actions">
        <div className="mw-action-tabs" role="group" aria-label="Pool role">
          <button type="button" aria-pressed={role === "lp"} className={role === "lp" ? "is-active" : ""} onClick={() => onRoleChange("lp")}>Provide liquidity</button>
          <button type="button" aria-pressed={role === "underwriter"} className={role === "underwriter" ? "is-active" : ""} onClick={() => onRoleChange("underwriter")}>Underwrite</button>
        </div>
        {role === "lp" ? <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><PiggyBank size={16} /> Create LP position</h2><span>ONE ASSET · USDC</span></div>
          <div className="mw-trade-inner">
            <p>Choose an amount. Nacre models the WETH / USDC split for this exact range and current price.</p>
            <AmountField label="USDC to provide (sandbox USD)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <>
              <div className="mw-split"><div><small>Swap to WETH</small><strong>{usd(quote.split.swapUsd)}</strong><span>{quote.split.ethAmount} WETH</span></div><div><small>Keep as USDC</small><strong>{usd(quote.split.usdcAmount)}</strong><span>{(100 - quote.split.ethPercent).toFixed(1)}% of deposit</span></div></div>
              <div className="mw-quote"><div><span>30-day fee floor</span><strong>{usd(quote.feeFloorUsd)}</strong></div><div><span>Indicative premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Backed payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Net fee floor</span><strong>{usd(quote.minimumNetFeesUsd)}</strong></div></div>
              <div className={`mw-availability${quote.available ? " is-open" : ""}`}><ShieldCheck size={15} /> {quote.available ? `Limited cover available · ${usd(selected.coverRemainingUsd)} left` : `No insurance available${quote.reasons.length ? `: ${quote.reasons.join(" ")}` : ""}`}</div>
            </>}
            <Button className="kd-apply-button" disabled={busy || !participant || !quote} onClick={() => void invest(false)}>Record LP deposit <ArrowRight size={15} /></Button>
            <Button variant="outline" disabled={busy || !participant || !quote?.available} onClick={() => void invest(true)}>Deposit with cover</Button>
            <small className="mw-action-note">Sandbox record only. No wallet transaction or swap occurs.</small>
          </div>
        </Card> : <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Back fee coverage</h2><span>FINITE CAPACITY</span></div>
          <div className="mw-trade-inner">
            <p>Pledge capacity to back LP fee shortfalls. A covered LP reserves its full payout cap from the pool.</p>
            <div className="mw-underwriter-figures"><div><span>Pool capacity pledged</span><strong>{usd(selected.pledgedUsd)}</strong></div><div><span>Unreserved</span><strong>{usd(selected.coverRemainingUsd)}</strong></div></div>
            <AmountField label="Example LP position (USD)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <><div className="mw-quote"><div><span>Indicative premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Full payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Modeled payout</span><strong>{usd(quote.expectedPayoutUsd)}</strong></div><div><span>Modeled margin</span><strong>{usd(quote.underwriterMarginUsd)}</strong></div></div><p className="mw-risk-note">Full payout cap is at risk. Modeled margin is a research estimate, not earned profit. Edge risk: {quote.edgeRiskPct}%.</p></>}
            <AmountField label="USDC capacity to pledge (sandbox USD)" value={pledge} onChange={setPledge} min={1} />
            {!selected.inRange && <div className="mw-availability"><ShieldCheck size={15} /> No new coverage while the current tick is outside the range.</div>}
            <Button className="kd-apply-button" disabled={busy || !participant} onClick={() => void pledgeCapacity()}>Record underwriting interest <ArrowRight size={15} /></Button>
            <Link className="mw-evidence-link" href="/dashboard/backtest">Review six-month fee evidence <ArrowRight size={14} /></Link>
            <small className="mw-action-note">No USDC is escrowed and no premium is collected in this sandbox.</small>
          </div>
        </Card>}
        <Card className="kd-card mw-trade-card mw-scenario-card">
          <div className="kd-card-heading"><h2><RefreshCw size={16} /> Price scenario</h2><span>MANUAL TICK</span></div>
          <div className="mw-trade-inner"><AmountField label="New WETH price (USD)" value={simulatedPrice} onChange={setSimulatedPrice} min={1} /><Button variant="outline" disabled={busy || !simulatedPrice} onClick={() => void movePrice()}>Record price move</Button><small className="mw-action-note">Adds a point to the sandbox chart. This is not a live oracle price.</small></div>
        </Card>
      </aside>
    </div>}
  </div>;
}

export function WorkspacePortfolio({ role }: { role: WorkspaceRole }) {
  const participant = useParticipant();
  const [positions, setPositions] = useState<Position[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState("");
  useEffect(() => {
    if (!participant) return;
    const controller = new AbortController();
    void Promise.all([
      api<{ positions: Position[] }>(`portfolio?participant=${encodeURIComponent(participant)}`),
      api<{ pledges: Pledge[] }>(`underwriting?participant=${encodeURIComponent(participant)}`),
      api<{ markets: Market[] }>("markets"),
    ]).then(([portfolio, underwriting, directory]) => {
      if (!controller.signal.aborted) { setPositions(portfolio.positions); setPledges(underwriting.pledges); setMarkets(directory.markets); }
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [participant, refreshKey]);
  const invested = positions.reduce((sum, position) => sum + position.depositUsd, 0);
  const protectedFloor = positions.reduce((sum, position) => sum + position.feeFloorUsd, 0);
  const premium = positions.reduce((sum, position) => sum + position.premiumUsd, 0);
  const pledged = pledges.reduce((sum, item) => sum + item.capacityUsd, 0);

  async function addCover(position: Position) {
    setBusyId(position.id); setError(""); setNotice("");
    try {
      await api(`markets/${position.marketId}/positions/${position.id}/cover`, "POST", { participant });
      setNotice("Sandbox cover recorded for this position."); setRefreshKey((n) => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Coverage unavailable"); }
    finally { setBusyId(""); }
  }

  return <div className="mw-page"><div className="mw-banner"><CircleHelp size={16} /><p><strong>Sandbox portfolio</strong> · {role === "lp" ? "LP deposits and protected floors are saved simulations. Realized fees are not tracked yet." : "Underwriting pledges record interest only. No USDC is locked, and no premium or payout is recorded."}</p></div>
    {role === "underwriter" ? <><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>CAPACITY PLEDGED</span><strong>{usd(pledged)}</strong><small>{pledges.length} sandbox {pledges.length === 1 ? "pledge" : "pledges"}</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>MARKETS BACKED</span><strong>{new Set(pledges.map((item) => item.marketId)).size}</strong><small>Sandbox pool drafts</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PREMIUM RECEIVED</span><strong>$0.00</strong><small>No active policy or payment</small></div></Card></div>{error && <div className="mw-message is-error" role="alert">{error}</div>}
      <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Your underwriting interest</h2><span>{pledges.length} {pledges.length === 1 ? "PLEDGE" : "PLEDGES"}</span></div><div className="mw-position-list">{pledges.length ? pledges.map((item) => { const market = markets.find((row) => row.id === item.marketId); return <div key={item.id} className="mw-position"><TokenPairIcon pair={market?.pair ?? "WETH / USDC"} size="small" /><div><strong>{market?.pair ?? "Pool draft"}</strong><small>{new Date(item.createdAt).toLocaleDateString()} · No collateral locked</small></div><strong>{usd(item.capacityUsd)}</strong><Button asChild variant="outline" size="sm"><Link href={`/dashboard/pools/${item.marketId}`}>View pool</Link></Button></div>; }) : <div className="mw-portfolio-empty"><ShieldCheck size={24} /><h2>No underwriting pledges yet</h2><p>Explore a pool, review its range and historical evidence, then record the capacity you would consider backing.</p><Button asChild variant="outline"><Link href="/dashboard/pools">Explore pools <ArrowRight size={15} /></Link></Button></div>}</div></Card></> : <><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>RECORDED CAPITAL</span><strong>{usd(invested)}</strong><small>{positions.length} sandbox positions</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PROTECTED FLOOR</span><strong>{usd(protectedFloor)}</strong><small>30-day modeled total</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>MODELED PREMIUM</span><strong>{usd(premium)}</strong><small>No payment collected</small></div></Card></div>{error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Your sandbox positions</h2><span>{positions.length} POSITIONS</span></div><div className="mw-position-list">{positions.length ? positions.map((position) => { const market = markets.find((item) => item.id === position.marketId); return <div key={position.id} className="mw-position"><TokenPairIcon pair={market?.pair ?? "WETH / USDC"} size="small" /><div><strong>{market?.pair ?? "WETH / USDC"}</strong><small>{new Date(position.createdAt).toLocaleDateString()} · {position.insured ? `Covered floor ${usd(position.feeFloorUsd)}` : "Uncovered LP deposit"}</small></div><strong>{usd(position.depositUsd)}</strong>{position.insured ? <Badge variant="outline">COVER RECORDED</Badge> : <Button variant="outline" size="sm" disabled={busyId === position.id || !market?.inRange || !market?.funded} onClick={() => void addCover(position)}>{market?.inRange && market?.funded ? "Check cover" : "No cover available"}</Button>}</div>; }) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No sandbox positions yet</h2><p>Create a pool or join one from the Pools page. Your recorded deposits will appear here.</p><Button asChild variant="outline"><Link href="/dashboard/pools">Browse pools <ArrowRight size={15} /></Link></Button></div>}</div></Card>
    </>}
  </div>;
}

export function WorkspaceOverview({ role }: { role: WorkspaceRole }) {
  const participant = useParticipant();
  const [positions, setPositions] = useState<Position[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!participant) return;
    let active = true;
    void Promise.all([
      api<{ positions: Position[] }>(`portfolio?participant=${encodeURIComponent(participant)}`),
      api<{ pledges: Pledge[] }>(`underwriting?participant=${encodeURIComponent(participant)}`),
      api<{ markets: Market[] }>("markets"),
    ]).then(([lp, underwriting, directory]) => {
      if (active) { setPositions(lp.positions); setPledges(underwriting.pledges); setMarkets(directory.markets); }
    }).catch((reason) => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [participant]);

  const lpCapital = positions.reduce((sum, item) => sum + item.depositUsd, 0);
  const protectedFloor = positions.reduce((sum, item) => sum + item.feeFloorUsd, 0);
  const capacity = pledges.reduce((sum, item) => sum + item.capacityUsd, 0);
  const activeMarkets = markets.filter((market) => market.funded && market.inRange).length;

  return <div className="mw-role-overview">
    <div className="mw-role-intro"><div><span>{role === "lp" ? "LIQUIDITY PROVIDER" : "UNDERWRITER"} / OVERVIEW</span><h2>{role === "lp" ? "Your liquidity at a glance" : "Your underwriting desk"}</h2><p>{role === "lp" ? "Track recorded deposits and fee floors, then find a pool that still has cover capacity." : "Review pledged capacity and market evidence before backing an LP fee floor."}</p></div><Button asChild variant="outline"><Link href={role === "lp" ? "/dashboard/pools" : "/dashboard/backtest"}>{role === "lp" ? "Explore pools" : "Open backtest"} <ArrowRight size={15} /></Link></Button></div>
    {error && <div className="mw-message is-error" role="alert">{error}</div>}
    <div className="mw-stats mw-role-stats">{role === "lp" ? <>
      <Card className="kd-card"><div className="mw-stat"><span>RECORDED LP CAPITAL</span><strong>{usd(lpCapital)}</strong><small>{positions.length} sandbox positions</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>PROTECTED FEE FLOOR</span><strong>{usd(protectedFloor)}</strong><small>30-day modeled total</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>FUNDED, IN-RANGE POOLS</span><strong>{activeMarkets}</strong><small>{markets.length} pool drafts recorded</small></div></Card>
    </> : <>
      <Card className="kd-card"><div className="mw-stat"><span>CAPACITY PLEDGED</span><strong>{usd(capacity)}</strong><small>Sandbox interest only</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>MARKETS BACKED</span><strong>{new Set(pledges.map((item) => item.marketId)).size}</strong><small>{pledges.length} recorded pledges</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>PREMIUM RECEIVED</span><strong>$0.00</strong><small>No live policy or payment</small></div></Card>
    </>}</div>
    <Card className="kd-card mw-role-next"><div className="kd-card-heading"><h2>{role === "lp" ? <><PiggyBank size={16} /> Your next step</> : <><ShieldCheck size={16} /> Underwriting workflow</>}</h2><span>SANDBOX</span></div><div className="mw-role-next-inner"><h3>{role === "lp" ? positions.length ? "Review your positions" : "Start with a liquidity pool" : pledges.length ? "Review your backed pools" : "Compare risk before pledging"}</h3><p>{role === "lp" ? "Choose a price range, supply USDC, and check whether finite fee-floor coverage is available for your position." : "Use six months of pool volume and fee evidence, inspect the LP range, then pledge only the capacity you want to back."}</p><Link href={role === "lp" ? positions.length ? "/dashboard/portfolio" : "/dashboard/pools" : pledges.length ? "/dashboard/portfolio" : "/dashboard/backtest"}>{role === "lp" ? positions.length ? "View portfolio" : "Browse pools" : pledges.length ? "View pledges" : "Study backtest"} <ArrowRight size={15} /></Link></div></Card>
  </div>;
}
