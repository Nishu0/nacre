"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ExternalLink, ShieldCheck } from "lucide-react";
import { formatUnits } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { CoverageFunding, OfferRow } from "@/components/coverage-workspace";
import { WorkspacePools, type Market, type WorkspaceRole } from "@/components/market-workspace";

import { basescanTx, priceToRawTick, priceInputToTick } from "@/lib/nacre-chain";
import { tickPrice } from "@/lib/coverage-contracts";
import { availableBid } from "@/lib/funded-bids";
import { useCoverage } from "@/lib/use-coverage";

const money = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD" });

type BidWorkspaceProps = {
  role: WorkspaceRole; walletAccount: string | null; onConnect: () => Promise<void>; onRoleChange: (role: WorkspaceRole) => void; marketId?: string;
};
export function BidWorkspace(props: BidWorkspaceProps) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/workspace/bid-markets", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const value = await response.json(); if (!response.ok) throw new Error(value.error); return value; })
      .then((value) => { if (!controller.signal.aborted) { setMarkets(value.markets); setLoaded(true); } })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, []);
  if (error) return <p role="alert" className="mw-premium-warning">{error}</p>;
  if (!loaded) return <p role="status">Loading pools…</p>;
  const visibleMarkets = markets.filter((row) => !row.archived && row.deployment);
  if (!props.marketId) return <div className="mw-page">
    {!visibleMarkets.length ? <Card className="kd-card"><div className="mw-trade-inner"><h2>No pools yet</h2><p>{props.role === "underwriter" ? "Create a pool to start funding coverage bids." : "Created pools will appear here. Choose a pool to view its funded bids."}</p></div></Card> : <div className="mw-directory-grid">{visibleMarkets.map((row) => <Link key={row.id} href={`/dashboard/pools/${row.id}`} className="mw-directory-card">
      <div className="mw-directory-top"><TokenPairIcon pair={row.pair} size="large" /><Badge variant="outline">INITIALIZED</Badge></div>
      <div><h3>{row.pair}</h3><p>{row.feeTier} trading fee · Base Sepolia</p></div>
      <p>{props.role === "underwriter" ? "Choose a range and fund a coverage bid." : "View the ranges available for fee protection."}</p>
      <div className="mw-directory-open">View pool <ArrowRight size={15} /></div>
    </Link>)}</div>}
  </div>;
  const market = markets.find((row) => row.id === props.marketId);
  if (!market?.deployment) return <div className="mw-page"><h2>Pool not found</h2><Link href="/dashboard/pools">Back to pools</Link></div>;
  return <div className="mw-page">
    <div className="mw-heading"><div><Link className="mw-back-link" href="/dashboard/pools">← All pools</Link><div className="mw-title-with-icon"><TokenPairIcon pair={market.pair} size="large" /><h2>{market.pair}</h2></div><p>{market.feeTier} trading fee · Base Sepolia</p></div>
      <a className="mw-initialized-link" href={basescanTx(market.deployment.txHash)} target="_blank" rel="noreferrer">Initialized <ExternalLink size={16} /></a>
    </div>
    <PoolBids key={market.id} {...props} market={market} />
  </div>;
}
function PoolBids({ role, walletAccount, onConnect, onRoleChange, market }: BidWorkspaceProps & { market: Market }) {
  const { data, error, refresh } = useCoverage(market.deployment!.poolId);
  const [chosen, setChosen] = useState<string | null>(null);
  const bids = data?.offers.filter((bid) => !bid.closed && BigInt(bid.available) > 0n) ?? [];
  const selected = bids.find((bid) => bid.address === chosen);
  if (role === "lp" && chosen && market && selected) return <div className="mw-page">
    <Button variant="outline" onClick={() => setChosen(null)}><ArrowLeft size={14} /> All funded bids</Button>
    <WorkspacePools key={selected.address} marketId={market.id} bid={selected} role={role} walletAccount={walletAccount} onConnect={onConnect} onRoleChange={onRoleChange} />
  </div>;
  return <div className="mw-page">
    {error && <p role="alert" className="mw-premium-warning">{error}</p>}
    {chosen && !selected && data && <p role="status">That bid is no longer available. Choose another funded bid.</p>}
    {role === "underwriter" && market && data && <BidForm key={walletAccount ?? "disconnected"} market={market} current={tickPrice(data.currentTick)} account={walletAccount} onConnect={onConnect} />}
    <Card className="kd-card cw-board"><div className="kd-card-heading"><h2><ShieldCheck size={16} />{role === "underwriter" ? "Funded bids" : "Available coverage bids"}</h2><button type="button" onClick={() => void refresh()}>Refresh</button></div><div className="mw-trade-inner">
      {!data ? <p>Loading funded bids…</p> : !bids.length ? <div className="mw-portfolio-empty"><h3>No funded bids yet</h3><p>{role === "underwriter" ? "Choose your range and fund the first bid above." : "An underwriter must fund a range before you can provide liquidity and buy coverage."}</p></div> : bids.map((bid) => {
        const mine = bid.owner.toLowerCase() === walletAccount?.toLowerCase();
        const inRange = data.currentTick >= bid.tickLower && data.currentTick < bid.tickUpper;
        return role === "underwriter" ? <OfferRow key={bid.address} offer={bid} account={walletAccount} disabled={!!error} canManage />
          : <div className="cw-policy" key={bid.address}>
            <div className="cw-row"><strong>nWETH / nUSDC</strong><span>{bid.duration / 86400} days</span></div>
            <h3>{money(tickPrice(bid.tickLower))} – {money(tickPrice(bid.tickUpper))}</h3>
            <div className="cw-terms"><span>{(bid.tickUpper - bid.tickLower) / 10} bins · fixed range</span><span>Available cover: {formatUnits(BigInt(bid.available), 6)} nUSDC</span><strong>Premium: {bid.premiumBps / 100}% of your fee cap</strong></div>
            <small>Underwriter {bid.owner.slice(0, 6)}…{bid.owner.slice(-4)}</small>
            {mine && <p>This is your bid. Another wallet can buy it.</p>}
            {!inRange && <p>Currently outside this range. Purchases resume when the pool price returns inside.</p>}
            <Button className="kd-apply-button" disabled={!market || !!error || !availableBid(bid, data.currentTick, walletAccount)} onClick={() => setChosen(bid.address)}>Select funded bid <ArrowRight size={14} /></Button>
          </div>;
      })}
    </div></Card>
  </div>;
}

function BidForm({ market, current, account, onConnect }: { market: Market; current: number; account: string | null; onConnect: () => Promise<void> }) {
  const [lower, setLower] = useState((current * .9).toFixed(2));
  const [upper, setUpper] = useState((current * 1.1).toFixed(2));
  const minimum = tickPrice(priceToRawTick(market.lowerPriceUsd) + 10);
  const maximum = tickPrice(priceToRawTick(market.upperPriceUsd));
  const valid = Number.isFinite(Number(lower)) && Number.isFinite(Number(upper)) && tickPrice(priceInputToTick(lower)) >= minimum
    && tickPrice(priceInputToTick(upper)) <= maximum && Number(lower) < Number(upper);
  return <div className="bw-form-grid"><Card className="kd-card"><div className="kd-card-heading"><h2>Your bid range</h2><span>nWETH / nUSDC</span></div><div className="mw-trade-inner">
    <p>Set the price range you want to cover. Investors will use these exact bins and your bid’s duration.</p>
    <div className="cw-terms"><span>On-chain pool price</span><strong>{money(current)}</strong></div>
    <label className="mw-field"><span>Minimum nWETH price (USD)</span><Input type="number" value={lower} onChange={(event) => setLower(event.target.value)} /></label>
    <label className="mw-field"><span>Maximum nWETH price (USD)</span><Input type="number" value={upper} onChange={(event) => setUpper(event.target.value)} /></label>
    {!valid && <p role="status">Enter a range inside {money(minimum)}–{money(maximum)}.</p>}
  </div></Card>{valid && <CoverageFunding account={account} onConnect={onConnect} poolId={market.deployment!.poolId} lower={Number(lower)} upper={Number(upper)} />}</div>;
}
