"use client";

import { useEffect, useState } from "react";
import { Activity, ArrowRight, CircleHelp, Droplets, PiggyBank, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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

export function WorkspacePools() {
  const participant = useParticipant();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedId, setSelectedId] = useState("");
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
      setSelectedId((current) => current || rows[0]?.id || "");
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!selectedId || !Number(deposit)) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void api<{ quote: Quote }>(`markets/${selectedId}/quote?depositUsd=${encodeURIComponent(deposit)}`)
        .then((data) => { if (!controller.signal.aborted) setQuoteState({ marketId: selectedId, data: data.quote }); })
        .catch(() => { if (!controller.signal.aborted) setQuoteState(null); });
    }, 180);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [selectedId, deposit, refreshKey]);

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
    if (result) { setSelectedId(result.market.id); setCreating(false); }
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
    <div className="mw-heading"><div><h2>Pool directory</h2><p>Start with one-asset USDC, size a WETH/USDC position, then check finite cover capacity.</p></div><Button className="kd-apply-button" onClick={() => setCreating(!creating)}><Plus size={15} /> Create pool</Button></div>
    {creating && <Card className="kd-card mw-form-card"><div className="kd-card-heading"><h2><Droplets size={16} /> New pool draft</h2><Badge variant="outline">WETH / USDC · 0.05%</Badge></div><div className="mw-form-inner"><div className="mw-fields"><AmountField label="Current ETH price (USD)" value={price} onChange={setPrice} min={1} /><AmountField label="Lower range price" value={lower} onChange={setLower} min={1} /><AmountField label="Upper range price" value={upper} onChange={setUpper} min={1} /><AmountField label="LP funding target (USD)" value={target} onChange={setTarget} min={100} /><AmountField label="Protection capacity target (USD)" value={budget} onChange={setBudget} min={1} /></div><p>Price and ticks are sandbox inputs. A real v4 pool must use the deployed hook and an independent price feed.</p><Button className="kd-apply-button" disabled={busy || !participant} onClick={createMarket}>Create draft <ArrowRight size={15} /></Button></div></Card>}
    {error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    {!markets.length && !creating && <Card className="kd-card kd-empty-panel"><div className="kd-empty-panel-inner"><div className="kd-empty-art"><Droplets size={28} strokeWidth={1.4} /></div><Badge variant="outline">POOL DIRECTORY</Badge><h2>No Nacre pool drafts yet</h2><p>Create a sandbox market to test liquidity funding, underwriting interest, tick movement, and limited cover.</p><Button className="kd-apply-button" onClick={() => setCreating(true)}><Plus size={15} /> Create first pool</Button></div></Card>}
    {!!markets.length && <div className="mw-layout"><div className="mw-market-list">{markets.map((market) => <button type="button" key={market.id} className={`mw-market-button${market.id === selectedId ? " is-active" : ""}`} onClick={() => { setSelectedId(market.id); setQuoteState(null); setNotice(""); }}><span className="mw-token-icon">Ξ</span><span><strong>{market.pair}</strong><small>{market.feeTier} · {usd(market.priceUsd)} / ETH</small></span><Badge variant="outline">{market.status.replaceAll("_", " ")}</Badge></button>)}</div>
      {selected && <div className="mw-market-detail"><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>LP FUNDED</span><strong>{usd(selected.investedUsd)}</strong><small>of {usd(selected.liquidityTargetUsd)} target</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PROTECTION PLEDGED</span><strong>{usd(selected.pledgedUsd)}</strong><small>{usd(selected.coverRemainingUsd)} unreserved</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>CURRENT TICK</span><strong>{selected.currentTick}</strong><small>{selected.tickLower} to {selected.tickUpper}</small></div></Card></div>
        <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><Activity size={16} /> Range and launch status</h2><Badge variant="outline">{selected.inRange ? selected.funded ? "FUNDED · IN RANGE" : "FUNDING · IN RANGE" : "OUT OF RANGE"}</Badge></div><div className="mw-panel-inner"><div className="mw-range"><span>{usd(selected.lowerPriceUsd)}</span><div className="mw-range-track"><i style={{ left: `${Math.max(0, Math.min(100, (selected.priceUsd - selected.lowerPriceUsd) / (selected.upperPriceUsd - selected.lowerPriceUsd) * 100))}%` }} /></div><span>{usd(selected.upperPriceUsd)}</span></div><p>New insurance closes when the tick falls below {selected.tickLower} or reaches {selected.tickUpper}. Existing sandbox coverage stays recorded for its agreed window.</p><div className="mw-progress-grid"><div><span>Liquidity</span><progress value={selected.investedUsd} max={selected.liquidityTargetUsd} /><small>{Math.min(100, Math.round(selected.investedUsd / selected.liquidityTargetUsd * 100))}% of target</small></div><div><span>Protection</span><progress value={selected.pledgedUsd} max={selected.collateralBudgetUsd} /><small>{Math.min(100, Math.round(selected.pledgedUsd / selected.collateralBudgetUsd * 100))}% of target</small></div></div></div></Card>
        <div className="mw-actions-grid"><Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Provide liquidity</h2><span>ONE ASSET · USDC</span></div><div className="mw-panel-inner"><AmountField label="USDC to deposit (sandbox USD)" value={deposit} onChange={setDeposit} min={100} />{quote && <><div className="mw-split"><div><small>Swap via SwapVM concept</small><strong>{usd(quote.split.swapUsd)}</strong><span>to {quote.split.ethAmount} WETH</span></div><div><small>Keep as USDC</small><strong>{usd(quote.split.usdcAmount)}</strong><span>{(100 - quote.split.ethPercent).toFixed(1)}% of deposit</span></div></div><p>The {quote.split.ethPercent}% WETH split follows this range and current tick. A custom slider would leave unneeded tokens uninvested.</p><div className="mw-quote"><div><span>30-day fee floor</span><strong>{usd(quote.feeFloorUsd)}</strong></div><div><span>Indicative premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Fully backed cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>LP net floor</span><strong>{usd(quote.minimumNetFeesUsd)}</strong></div></div>{quote.available ? <div className="mw-availability is-open"><ShieldCheck size={15} /> Limited cover available · {usd(selected.coverRemainingUsd)} capacity left</div> : <div className="mw-availability"><ShieldCheck size={15} /> No insurance available{quote.reasons.length ? `: ${quote.reasons.join(" ")}` : ""}</div>}</>}
          <div className="mw-buttons"><Button className="kd-apply-button" disabled={busy || !participant || !quote} onClick={() => void invest(false)}>Record LP deposit</Button><Button variant="outline" disabled={busy || !participant || !quote?.available} onClick={() => void invest(true)}>Deposit with cover</Button></div></div></Card>
          <div className="mw-side-actions"><Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Underwrite</h2><span>FINITE CAPACITY</span></div><div className="mw-panel-inner"><AmountField label="USDC capacity to pledge" value={pledge} onChange={setPledge} min={1} /><p>Each covered position reserves its full payout cap. Additional buyers cannot reuse the same collateral.</p><Button variant="outline" disabled={busy || !participant} onClick={() => void pledgeCapacity()}>Record underwriting interest</Button></div></Card><Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><RefreshCw size={16} /> Move sandbox price</h2><span>TICK SCENARIO</span></div><div className="mw-panel-inner"><AmountField label="New ETH price (USD)" value={simulatedPrice} onChange={setSimulatedPrice} min={1} /><p>Move beyond the selected range to see new insurance disappear. This is a manual scenario, not a live oracle.</p><Button variant="outline" disabled={busy || !simulatedPrice} onClick={() => void movePrice()}>Update tick</Button></div></Card></div></div>
      </div>}</div>}
  </div>;
}

export function WorkspacePortfolio() {
  const participant = useParticipant();
  const [positions, setPositions] = useState<Position[]>([]);
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
      api<{ markets: Market[] }>("markets"),
    ]).then(([portfolio, directory]) => {
      if (!controller.signal.aborted) { setPositions(portfolio.positions); setMarkets(directory.markets); }
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [participant, refreshKey]);
  const invested = positions.reduce((sum, position) => sum + position.depositUsd, 0);
  const protectedFloor = positions.reduce((sum, position) => sum + position.feeFloorUsd, 0);
  const premium = positions.reduce((sum, position) => sum + position.premiumUsd, 0);

  async function addCover(position: Position) {
    setBusyId(position.id); setError(""); setNotice("");
    try {
      await api(`markets/${position.marketId}/positions/${position.id}/cover`, "POST", { participant });
      setNotice("Sandbox cover recorded for this position."); setRefreshKey((n) => n + 1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Coverage unavailable"); }
    finally { setBusyId(""); }
  }

  return <div className="mw-page"><div className="mw-banner"><CircleHelp size={16} /><p><strong>Sandbox portfolio</strong> · These entries are saved simulations. Fees earned are not tracked until a position and hook are active on-chain.</p></div><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>RECORDED CAPITAL</span><strong>{usd(invested)}</strong><small>{positions.length} sandbox positions</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PROTECTED FLOOR</span><strong>{usd(protectedFloor)}</strong><small>30-day modeled total</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>MODELED PREMIUM</span><strong>{usd(premium)}</strong><small>No payment collected</small></div></Card></div>{error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Your sandbox positions</h2><span>{positions.length} POSITIONS</span></div><div className="mw-position-list">{positions.length ? positions.map((position) => { const market = markets.find((item) => item.id === position.marketId); return <div key={position.id} className="mw-position"><span className="mw-token-icon">Ξ</span><div><strong>{market?.pair ?? "WETH / USDC"}</strong><small>{new Date(position.createdAt).toLocaleDateString()} · {position.insured ? `Covered floor ${usd(position.feeFloorUsd)}` : "Uncovered LP deposit"}</small></div><strong>{usd(position.depositUsd)}</strong>{position.insured ? <Badge variant="outline">COVER RECORDED</Badge> : <Button variant="outline" size="sm" disabled={busyId === position.id || !market?.inRange || !market?.funded} onClick={() => void addCover(position)}>{market?.inRange && market?.funded ? "Check cover" : "No cover available"}</Button>}</div>; }) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No sandbox positions yet</h2><p>Create a pool or join one from the Pools page. Your recorded deposits will appear here.</p><Button asChild variant="outline"><a href="/dashboard/pools">Browse pools <ArrowRight size={15} /></a></Button></div>}</div></Card>
  </div>;
}
