"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CircleHelp, Droplets, ExternalLink, PiggyBank, Plus, Rocket, ShieldCheck } from "lucide-react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { PoolPriceChart, type OraclePoint } from "@/components/pool-price-chart";
import { PoolRiskAnalysis, type RiskReport } from "@/components/pool-risk-analysis";
import { PoolRangeEditor } from "@/components/pool-range-editor";
import { baseClient, basescanTx, ensureBaseSepolia, erc20Abi, injectedClient, mintParameters,
  NACRE_TEST_USDC, BASE_WETH, UNISWAP_PERMIT2,
  UNISWAP_POSITION_MANAGER, UNISWAP_STATE_VIEW, permit2Abi, positionManagerAbi,
  stateViewAbi, wethAbi, sqrtPriceX96ToWethUsd } from "@/lib/nacre-chain";

export type WorkspaceRole = "lp" | "underwriter";

type Market = {
  id: string; pair: string; feeTier: string; priceUsd: number; lowerPriceUsd: number;
  upperPriceUsd: number; currentTick: number; tickLower: number; tickUpper: number;
  liquidityTargetUsd: number; collateralBudgetUsd: number; investedUsd: number;
  pledgedUsd: number; reservedUsd: number; coverRemainingUsd: number;
  funded: boolean; inRange: boolean; status: string;
  deployment: { txHash: string; poolId: string; deployedAt: string } | null;
};
type Quote = {
  depositUsd: number; split: { ethAmount: number; usdcAmount: number; swapUsd: number; ethPercent: number };
  lowerPriceUsd: number; upperPriceUsd: number;
  feeFloorUsd: number; payoutCapUsd: number; premiumUsd: number; expectedPayoutUsd: number;
  underwriterMarginUsd: number; minimumNetFeesUsd: number; alternative30DayUsd: number;
  edgeRiskPct: number;
  available: boolean; reasons: string[];
};
type FeePreview = {
  principalUsd: number; windowDays: number; sampleDays: number; windowCount: number;
  recentFeesUsd: number; bestFeesUsd: number; maximumFeeTargetUsd: number;
  suggestedFeeTargetUsd: number; feeTargetUsd: number; indicativePremiumUsd: number;
  method: string;
};
type ChainPosition = { tokenId: string; marketId: string; txHash: string; wethRaw: string; usdcRaw: string; mintedAt: string };
type LivePrices = {
  source: "Pyth" | "Chainlink"; network: string; sourceUrl: string; fetchedAt: string;
  assets: { WETH: { usd: number; publishedAt: string; confidenceUsd?: number };
    USDC: { usd: number; publishedAt: string; confidenceUsd?: number } };
  wethUsdc: number;
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

function AmountField({ label, value, onChange, min = 0 }: {
  label: string; value: string; onChange: (value: string) => void; min?: number;
}) {
  return <label className="mw-field"><span>{label}</span><Input type="number" inputMode="decimal" min={min} step="any" value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

export function WorkspacePools({ marketId, role, onRoleChange, walletAccount, onConnect }: { marketId?: string; role: WorkspaceRole; onRoleChange: (role: WorkspaceRole) => void; walletAccount: string | null; onConnect: () => Promise<void> }) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [chainPositions, setChainPositions] = useState<ChainPosition[]>([]);
  const [poolSlot, setPoolSlot] = useState<{ priceUsd: number; tick: number } | null>(null);
  const [oraclePoints, setOraclePoints] = useState<OraclePoint[]>([]);
  const [livePrices, setLivePrices] = useState<LivePrices | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [selectedId, setSelectedId] = useState(marketId ?? "");
  const [quoteState, setQuoteState] = useState<{ marketId: string; data: Quote } | null>(null);
  const [feePreviewState, setFeePreviewState] = useState<{ marketId: string; targetInput: string; data: FeePreview } | null>(null);
  const [feeError, setFeeError] = useState("");
  const [riskState, setRiskState] = useState<{ marketId: string; depositUsd: number; lower: number; upper: number; data: RiskReport } | null>(null);
  const [riskError, setRiskError] = useState("");
  const [error, setError] = useState("");
  const [hasPoolDraft, setHasPoolDraft] = useState(false);
  const [deposit, setDeposit] = useState("1000");
  const [coverageDays, setCoverageDays] = useState(30);
  const [feeTargetInput, setFeeTargetInput] = useState("");
  const [pledge, setPledge] = useState("100");
  const [rangeLower, setRangeLower] = useState("");
  const [rangeUpper, setRangeUpper] = useState("");
  const [premium, setPremium] = useState("");
  const [wethBalance, setWethBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [tokenRefresh, setTokenRefresh] = useState(0);
  const [mintBusy, setMintBusy] = useState(false);
  const [mintStep, setMintStep] = useState("");
  const [mintError, setMintError] = useState("");
  const [mintHash, setMintHash] = useState<Hex | null>(null);
  const [mintTokenId, setMintTokenId] = useState<string | null>(null);
  const [mintConfirmed, setMintConfirmed] = useState(false);
  const [mintSaved, setMintSaved] = useState(false);
  const selected = markets.find((market) => market.id === selectedId);
  const selectedChainPositions = chainPositions.filter((position) => position.marketId === selectedId);
  const selectedWeth = selectedChainPositions.reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const selectedUsdc = selectedChainPositions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));
  const lower = Number(rangeLower || selected?.lowerPriceUsd);
  const upper = Number(rangeUpper || selected?.upperPriceUsd);
  const quote = quoteState?.marketId === selectedId && quoteState.data.depositUsd === Number(deposit)
    && quoteState.data.lowerPriceUsd === lower && quoteState.data.upperPriceUsd === upper
    ? quoteState.data : null;
  const feePreview = feePreviewState?.marketId === selectedId
    && feePreviewState.data.principalUsd === Number(deposit)
    && feePreviewState.data.windowDays === coverageDays
    && feePreviewState.targetInput === feeTargetInput ? feePreviewState.data : null;
  const risk = riskState?.marketId === selectedId && riskState.depositUsd === Number(deposit)
    && riskState.lower === lower && riskState.upper === upper
    ? riskState.data : null;

  useEffect(() => {
    if (!marketId) queueMicrotask(() => setHasPoolDraft(Boolean(localStorage.getItem("nacre-pool-create-draft-v1"))));
  }, [marketId]);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => { setRangeLower(String(selected.lowerPriceUsd)); setRangeUpper(String(selected.upperPriceUsd)); }, 0);
    return () => clearTimeout(timer);
  }, [selected?.id, selected?.lowerPriceUsd, selected?.upperPriceUsd]);

  useEffect(() => {
    if (!marketId || !walletAccount) {
      queueMicrotask(() => { setWethBalance(null); setUsdcBalance(null); });
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) { setWethBalance(null); setUsdcBalance(null); } });
    void Promise.all([
      baseClient.readContract({ address: BASE_WETH, abi: erc20Abi, functionName: "balanceOf", args: [walletAccount as Address] }),
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [walletAccount as Address] }),
    ]).then(([weth, usdc]) => { if (active) { setWethBalance(weth); setUsdcBalance(usdc); } })
      .catch(() => { if (active) { setWethBalance(null); setUsdcBalance(null); } });
    return () => { active = false; };
  }, [marketId, walletAccount, tokenRefresh]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api<LivePrices>("live-prices").then((value) => {
        if (!active) return;
        setLivePrices(value);
        setLiveError(false);
      }).catch(() => { if (active) setLiveError(true); });
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ markets: Market[] }>("markets").then(({ markets: rows }) => {
      if (controller.signal.aborted) return;
      setMarkets(rows);
      setSelectedId((current) => marketId || current || rows[0]?.id || "");
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [marketId]);

  useEffect(() => {
    let active = true;
    void api<{ positions: ChainPosition[] }>("chain-positions")
      .then(({ positions: rows }) => { if (active) setChainPositions(rows); })
      .catch(() => { if (active) setChainPositions([]); });
    return () => { active = false; };
  }, [tokenRefresh]);

  useEffect(() => {
    if (!selected?.deployment) {
      queueMicrotask(() => setPoolSlot(null));
      return;
    }
    let active = true;
    void baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi,
      functionName: "getSlot0", args: [selected.deployment.poolId as Hex] })
      .then(([sqrtPriceX96, tick]) => {
        if (active) setPoolSlot({ priceUsd: sqrtPriceX96ToWethUsd(sqrtPriceX96), tick });
      })
      .catch(() => { if (active) setPoolSlot(null); });
    return () => { active = false; };
  }, [selected?.deployment?.poolId]);

  useEffect(() => {
    if (!marketId) return;
    let active = true;
    void api<{ points: OraclePoint[] }>("live-price-history")
      .then(({ points }) => { if (active) setOraclePoints(points); })
      .catch(() => { if (active) setOraclePoints([]); });
    return () => { active = false; };
  }, [marketId, livePrices]);

  useEffect(() => {
    if (!marketId || !selectedId || !Number(deposit) || !lower || !upper || lower >= upper) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      void api<{ quote: Quote }>(`markets/${selectedId}/quote?depositUsd=${encodeURIComponent(deposit)}&lowerPriceUsd=${encodeURIComponent(lower)}&upperPriceUsd=${encodeURIComponent(upper)}`)
        .then((data) => { if (!controller.signal.aborted) setQuoteState({ marketId: selectedId, data: data.quote }); })
        .catch(() => { if (!controller.signal.aborted) setQuoteState(null); });
    }, 180);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [marketId, selectedId, deposit, lower, upper]);

  useEffect(() => {
    if (!marketId || !selectedId || !Number(deposit) || Number(deposit) < 100) return;
    let active = true;
    const timeout = setTimeout(() => {
      const targetQuery = feeTargetInput.trim() ? `&feeTargetUsd=${encodeURIComponent(feeTargetInput)}` : "";
      void api<FeePreview>(`markets/${selectedId}/fee-request?depositUsd=${encodeURIComponent(deposit)}&days=${coverageDays}${targetQuery}`)
        .then((data) => { if (active) { setFeePreviewState({ marketId: selectedId, targetInput: feeTargetInput, data }); setFeeError(""); } })
        .catch((reason) => { if (active) { setFeePreviewState(null); setFeeError(reason instanceof Error ? reason.message : "Fee evidence unavailable."); } });
    }, 180);
    return () => { active = false; clearTimeout(timeout); };
  }, [marketId, selectedId, deposit, coverageDays, feeTargetInput]);

  useEffect(() => {
    if (quote && !premium) {
      const timer = setTimeout(() => setPremium(quote.premiumUsd.toFixed(2)), 0);
      return () => clearTimeout(timer);
    }
  }, [quote, premium]);

  useEffect(() => {
    if (!marketId || !selectedId || role !== "underwriter" || !Number(deposit) || !lower || !upper || lower >= upper) return;
    let active = true;
    const timeout = setTimeout(() => {
      void api<RiskReport>(`markets/${selectedId}/risk?depositUsd=${encodeURIComponent(deposit)}&lowerPriceUsd=${encodeURIComponent(lower)}&upperPriceUsd=${encodeURIComponent(upper)}`)
        .then((data) => { if (active) { setRiskState({ marketId: selectedId, depositUsd: Number(deposit), lower, upper, data }); setRiskError(""); } })
        .catch((reason) => { if (active) { setRiskState(null); setRiskError(reason instanceof Error ? reason.message : "Risk evidence unavailable"); } });
    }, 180);
    return () => { active = false; clearTimeout(timeout); };
  }, [marketId, selectedId, role, deposit, lower, upper]);

  async function wrapWeth() {
    if (!walletAccount || !quote || mintBusy) return;
    const needed = parseUnits(quote.split.ethAmount.toFixed(8), 18);
    const deficit = needed > (wethBalance ?? BigInt(0)) ? needed - (wethBalance ?? BigInt(0)) : BigInt(0);
    if (!deficit) return;
    setMintBusy(true); setMintError(""); setMintStep("Wrapping test ETH to WETH…");
    try {
      await ensureBaseSepolia();
      const tx = await injectedClient().writeContract({ chain: baseClient.chain, account: walletAccount as Address,
        address: BASE_WETH, abi: wethAbi, functionName: "deposit", value: deficit });
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("WETH wrapping reverted.");
      setTokenRefresh((value) => value + 1);
      setMintStep("WETH ready for your position.");
    } catch (reason) { setMintError(reason instanceof Error ? reason.message : "Could not wrap test ETH."); }
    finally { setMintBusy(false); }
  }

  async function approveForPosition(token: Address, amount: bigint, account: Address) {
    if (amount <= BigInt(0)) return;
    const wallet = injectedClient();
    const tokenLabel = token.toLowerCase() === BASE_WETH.toLowerCase() ? "WETH" : "nUSDC";
    const tokenAllowance = await baseClient.readContract({ address: token, abi: erc20Abi,
      functionName: "allowance", args: [account, UNISWAP_PERMIT2] });
    if (tokenAllowance < amount) {
      setMintStep(`Approve ${tokenLabel} for Permit2…`);
      const tx = await wallet.writeContract({ chain: wallet.chain, account, address: token,
        abi: erc20Abi, functionName: "approve", args: [UNISWAP_PERMIT2, amount] });
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${tokenLabel} approval reverted.`);
    }
    const [permitted, expiration] = await baseClient.readContract({ address: UNISWAP_PERMIT2,
      abi: permit2Abi, functionName: "allowance", args: [account, token, UNISWAP_POSITION_MANAGER] });
    if (permitted < amount || expiration <= BigInt(Math.floor(Date.now() / 1000) + 120)) {
      setMintStep(`Approve PositionManager for ${tokenLabel}…`);
      const tx = await wallet.writeContract({ chain: wallet.chain, account, address: UNISWAP_PERMIT2,
        abi: permit2Abi, functionName: "approve",
        args: [token, UNISWAP_POSITION_MANAGER, amount, Math.floor(Date.now() / 1000) + 3600] });
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error(`${tokenLabel} PositionManager approval reverted.`);
    }
  }

  async function mintOnChain() {
    if (!selected?.deployment || !quote || !walletAccount || mintBusy) return;
    setMintBusy(true); setMintError(""); setMintStep("Checking on-chain pool price…");
    try {
      await ensureBaseSepolia();
      const account = walletAccount as Address;
      const wethAmount = parseUnits(quote.split.ethAmount.toFixed(8), 18);
      const usdcAmount = parseUnits(quote.split.usdcAmount.toFixed(6), 6);
      const [weth, usdc, slot] = await Promise.all([
        baseClient.readContract({ address: BASE_WETH, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi,
          functionName: "getSlot0", args: [selected.deployment.poolId as Hex] }),
      ]);
      if (weth < wethAmount) throw new Error(`Wrap ${formatUnits(wethAmount - weth, 18)} test ETH into WETH first.`);
      if (usdc < usdcAmount) throw new Error(`Claim test nUSDC from the faucet first. Required: ${formatUnits(usdcAmount, 6)}.`);
      if (slot[0] === BigInt(0)) throw new Error("The Uniswap pool has not been initialized.");
      const params = mintParameters({ sqrtPriceX96: slot[0], lowerPriceUsd: lower,
        upperPriceUsd: upper, wethAmount, usdcAmount, recipient: account });
      await approveForPosition(BASE_WETH, wethAmount, account);
      await approveForPosition(NACRE_TEST_USDC, usdcAmount, account);
      setMintStep("Minting Uniswap v4 position…");
      const wallet = injectedClient();
      const tx = await wallet.writeContract({ chain: wallet.chain, account, address: UNISWAP_POSITION_MANAGER,
        abi: positionManagerAbi, functionName: "modifyLiquidities",
        args: [params.unlockData, BigInt(Math.floor(Date.now() / 1000) + 600)] });
      setMintHash(tx);
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("Position mint reverted. Inspect the transaction on BaseScan.");
      setMintConfirmed(true);
      setMintStep("Saving the verified position to your portfolio…");
      const recorded = await api<{ tokenId: string }>(`markets/${selected.id}/chain-positions`, "POST", { txHash: tx, account });
      setMintTokenId(recorded.tokenId);
      setMintSaved(true);
      setTokenRefresh((value) => value + 1);
      setMintStep("Position minted on Base Sepolia.");
    } catch (reason) { setMintError(reason instanceof Error ? reason.message : "Could not mint the position."); }
    finally { setMintBusy(false); }
  }

  async function retryPositionRegistration() {
    if (!selected || !walletAccount || !mintHash || mintBusy) return;
    setMintBusy(true); setMintError(""); setMintStep("Verifying your minted position…");
    try {
      const recorded = await api<{ tokenId: string }>(`markets/${selected.id}/chain-positions`, "POST",
        { txHash: mintHash, account: walletAccount });
      setMintTokenId(recorded.tokenId);
      setMintSaved(true);
      setMintStep("Position added to your portfolio.");
    } catch (reason) { setMintError(reason instanceof Error ? reason.message : "Could not register the position."); }
    finally { setMintBusy(false); }
  }

  return <div className="mw-page">
    <div className="mw-heading"><div>{marketId && <Link className="mw-back-link" href="/dashboard/pools">← All pools</Link>}{marketId && selected ? <div className="mw-title-with-icon"><TokenPairIcon pair={selected.pair} size="large" /><h2>{selected.pair}</h2></div> : <h2>{marketId ? "Pool details" : "Pool directory"}</h2>}<p>{marketId ? "Review the live pool and choose a range before minting a position." : "Explore market proposals and deployed pools."}</p></div>{marketId && selected?.deployment ? <a className="mw-initialized-link" href={basescanTx(selected.deployment.txHash)} target="_blank" rel="noreferrer" aria-label="Initialized on Base Sepolia, view deployment transaction">Initialized <ExternalLink size={16} /></a> : marketId && selected ? <Badge variant="outline" className="mw-proposal-badge">Proposal</Badge> : <Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume pool draft" : "Create pool"}</Link></Button>}</div>
    {error && <div className="mw-message is-error" role="alert">{error}</div>}
    {!marketId && !markets.length && <Card className="kd-card kd-empty-panel"><div className="kd-empty-panel-inner"><div className="kd-empty-art"><Droplets size={28} strokeWidth={1.4} /></div><Badge variant="outline">POOL DIRECTORY</Badge><h2>No Nacre markets yet</h2><p>Create a market proposal to define a pair, range, and launch targets.</p><Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume saved draft" : "Create first pool"}</Link></Button></div></Card>}
    {!marketId && !!markets.length && <>
      <div className="mw-directory-summary"><span>MARKETS <strong>{markets.length}</strong></span><span>DEPLOYED <strong>{markets.filter((market) => market.deployment).length}</strong></span><span>LIQUIDITY POSITIONS <strong>{chainPositions.length}</strong></span></div>
      <div className="mw-directory-header"><h3>Available markets</h3><span>BASE SEPOLIA · WETH / nUSDC</span></div>
      <div className="mw-directory-grid">{markets.map((market) => {
        const minted = chainPositions.filter((position) => position.marketId === market.id);
        const usdcAtMint = minted.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));
        return <Link key={market.id} href={`/dashboard/pools/${market.id}`} className="mw-directory-card">
          <div className="mw-directory-top"><TokenPairIcon pair={market.pair} size="large" /><Badge variant="outline">{market.deployment ? "DEPLOYED" : "PROPOSAL"}</Badge></div>
          <div><h3>{market.pair}</h3><p>{market.feeTier} fee · Base Sepolia</p></div>
          <div className="mw-directory-metrics"><div><span>Liquidity positions</span><strong>{minted.length}</strong><small>Verified testnet mints</small></div><div><span>nUSDC provided</span><strong>{Number(formatUnits(usdcAtMint, 6)).toFixed(2)}</strong><small>At mint</small></div></div>
          <div className="mw-directory-open">View pool <ArrowRight size={15} /></div>
        </Link>;
      })}</div>
    </>}
    {marketId && !selected && !!markets.length && <Card className="kd-card mw-missing"><h3>Pool not found</h3><p>This market may have been removed.</p><Link href="/dashboard/pools">Back to pool directory <ArrowRight size={15} /></Link></Card>}
    {marketId && selected && <div className="mw-pool-detail">
      <Card className="kd-card mw-overview-wide">
        <div className="kd-card-heading"><h2><Activity size={16} /> Pool overview</h2><Badge variant="outline">{selected.feeTier} FEE · {selected.deployment ? "BASE SEPOLIA" : "PROPOSAL"}</Badge></div>
        <div className="mw-overview-wide-inner">
          <div className="mw-overview-tiles">
            <div><span>ON-CHAIN POOL PRICE</span><strong>{poolSlot ? usd(poolSlot.priceUsd) : "—"}</strong><small>{poolSlot ? `per WETH · tick ${poolSlot.tick}` : "Available after deployment"}</small></div>
            <div><span>LIVE WETH / USDC</span><strong>{livePrices ? usd(livePrices.wethUsdc) : "—"}</strong><small>{livePrices ? `${livePrices.source} · ${new Date(livePrices.assets.WETH.publishedAt).toLocaleTimeString()}` : liveError ? "Oracle unavailable" : "Fetching oracle…"}</small></div>
            <div><span>LIQUIDITY POSITIONS</span><strong>{selectedChainPositions.length}</strong><small>Verified Base Sepolia mints</small></div>
            <div><span>WETH PROVIDED</span><strong>{Number(formatUnits(selectedWeth, 18)).toFixed(5)}</strong><small>At mint</small></div>
            <div><span>nUSDC PROVIDED</span><strong>{Number(formatUnits(selectedUsdc, 6)).toFixed(2)}</strong><small>At mint</small></div>
          </div>
          <div className="mw-overview-range">
            <div><span>PROPOSED LP RANGE</span><strong>{usd(selected.lowerPriceUsd)} <em>to</em> {usd(selected.upperPriceUsd)}</strong><small>Choose exact bounds before minting</small></div>
            <div className="mw-overview-range-track"><i style={{ left: `${Math.max(0, Math.min(100, ((poolSlot?.priceUsd ?? livePrices?.wethUsdc ?? selected.priceUsd) - selected.lowerPriceUsd) / (selected.upperPriceUsd - selected.lowerPriceUsd) * 100))}%` }} /></div>
            <Badge variant="outline" className={poolSlot && poolSlot.priceUsd >= selected.lowerPriceUsd && poolSlot.priceUsd < selected.upperPriceUsd ? "is-in-range" : "is-out-of-range"}>{!poolSlot ? "POOL NOT INITIALIZED" : poolSlot.priceUsd >= selected.lowerPriceUsd && poolSlot.priceUsd < selected.upperPriceUsd ? "IN RANGE" : "OUT OF RANGE"}</Badge>
          </div>
          <div className="mw-overview-oracle-foot">{livePrices ? <><span>Oracle inputs: WETH/USD {usd(livePrices.assets.WETH.usd)} · USDC/USD {usd(livePrices.assets.USDC.usd)}</span><a href={livePrices.sourceUrl} target="_blank" rel="noreferrer">{livePrices.source} feed <ArrowRight size={12} /></a></> : <span>{liveError ? "Fresh oracle inputs are unavailable; the on-chain pool price is shown separately." : "Checking live oracle inputs…"}</span>}</div>
        </div>
      </Card>
      <div className="mw-market-layout">
      <section className="mw-market-center" aria-label="Price and funding">
        <PoolPriceChart points={oraclePoints} livePrice={livePrices?.wethUsdc} publishedAt={livePrices?.assets.WETH.publishedAt} source={livePrices?.source} lower={selected.lowerPriceUsd} upper={selected.upperPriceUsd} current={poolSlot?.priceUsd ?? selected.priceUsd} currentLabel={poolSlot ? "on-chain pool price" : "proposed starting price"} stale={liveError} />
        {!selected.deployment && <Card className="kd-card mw-funding-card">
          <div className="kd-card-heading"><h2><Rocket size={16} /> Pool deployment</h2><Badge variant="outline">PROPOSAL</Badge></div>
          <div className="mw-funding-inner">
            <div><span>Uniswap v4 pool</span><strong>Not deployed</strong><small>No on-chain liquidity or protection</small></div>
            <p>This proposal does not count as a live pool. New launches require an on-chain funding flow before they can be shown as deployed.</p>
          </div>
        </Card>}
      </section>
      <aside className="mw-market-actions" aria-label="Pool actions">
        <div className="mw-action-tabs" role="group" aria-label="Pool role">
          <button type="button" aria-pressed={role === "lp"} className={role === "lp" ? "is-active" : ""} onClick={() => onRoleChange("lp")}>Provide liquidity</button>
          <button type="button" aria-pressed={role === "underwriter"} className={role === "underwriter" ? "is-active" : ""} onClick={() => onRoleChange("underwriter")}>Underwrite</button>
        </div>
        <PoolRangeEditor minimum={selected.lowerPriceUsd} maximum={selected.upperPriceUsd} current={selected.priceUsd}
          lower={lower} upper={upper}
          onLower={(value) => setRangeLower(String(Math.max(selected.lowerPriceUsd, Math.min(value, upper - .01))))}
          onUpper={(value) => setRangeUpper(String(Math.min(selected.upperPriceUsd, Math.max(value, lower + .01))))} />
        {role === "lp" ? <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><PiggyBank size={16} /> Create LP position</h2><span>RANGE · WETH + nUSDC</span></div>
          <div className="mw-trade-inner">
            <p>Choose an amount and position range. The token split is modeled for this market; fee targets below use historical pool-level data.</p>
            <AmountField label="nUSDC to model (USD equivalent)" value={deposit} onChange={(value) => { setDeposit(value); setFeeTargetInput(""); }} min={100} />
            {quote && <>
              <div className="mw-split"><div><small>WETH required</small><strong>{usd(quote.split.swapUsd)}</strong><span>{quote.split.ethAmount} WETH</span></div><div><small>nUSDC required</small><strong>{usd(quote.split.usdcAmount)}</strong><span>{(100 - quote.split.ethPercent).toFixed(1)}% of deposit</span></div></div>
            </>}
            <div className="mw-fee-request">
              <div className="mw-fee-request-head"><strong>Minimum fee target</strong><span>HISTORICAL PREVIEW</span></div>
              <label className="mw-field"><span>Coverage duration</span><select value={coverageDays} onChange={(event) => { setCoverageDays(Number(event.target.value)); setFeeTargetInput(""); }} aria-label="Coverage duration">{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
              <AmountField label={`Minimum fees to protect over ${coverageDays} days (USD)`} value={feeTargetInput} onChange={setFeeTargetInput} min={0.01} />
              <small>Leave the target blank to use the suggested amount from the latest {coverageDays}-day window.</small>
              {feePreview && <><div className="mw-fee-evidence"><div><span>Recent {coverageDays} days</span><strong>{usd(feePreview.recentFeesUsd)}</strong></div><div><span>Best {coverageDays} days</span><strong>{usd(feePreview.bestFeesUsd)}</strong></div><div><span>Maximum target · 90% of best</span><strong>{usd(feePreview.maximumFeeTargetUsd)}</strong></div><div><span>Your minimum target</span><strong>{usd(feePreview.feeTargetUsd)}</strong></div></div><p>Indicative premium for that target: <strong>{usd(feePreview.indicativePremiumUsd)}</strong>. Based on {feePreview.windowCount} historical windows across {feePreview.sampleDays} days; this is a pool-level proxy, not a quote for your exact ticks.</p></>}
              {feeError && <p className="mw-premium-warning" role="alert">{feeError}</p>}
            </div>
            <div className="mw-availability"><ShieldCheck size={15} /><span><strong>Coverage is not active.</strong> An underwriter must lock collateral for the fee target before protection can be offered. Your nUSDC balance pays for your LP deposit; it does not fund insurance.</span></div>
            {(!walletAccount || (quote && usdcBalance !== null && usdcBalance < parseUnits(quote.split.usdcAmount.toFixed(6), 6))) && <Button asChild variant="outline" className="mw-faucet-link"><Link href="/dashboard/faucet">Get test nUSDC for liquidity <ArrowRight size={14} /></Link></Button>}
            <div className="mw-onchain-lp">
              <div><strong>Mint a real testnet LP position</strong><span>{selected.deployment ? "Uniswap v4 · Base Sepolia" : "Available after admin pool deployment"}</span></div>
              {walletAccount && quote && <div className="mw-token-balance"><span>Need {quote.split.ethAmount} WETH <small>Have {wethBalance === null ? "…" : Number(formatUnits(wethBalance, 18)).toFixed(5)}</small></span><span>Need {usd(quote.split.usdcAmount)} nUSDC <small>Have {usdcBalance === null ? "…" : Number(formatUnits(usdcBalance, 6)).toFixed(2)}</small></span></div>}
              {selected.deployment && !walletAccount && <Button variant="outline" onClick={() => void onConnect()}>Connect wallet to mint</Button>}
              {selected.deployment && walletAccount && quote && <>
                {wethBalance !== null && wethBalance < parseUnits(quote.split.ethAmount.toFixed(8), 18) && <Button variant="outline" disabled={mintBusy} onClick={() => void wrapWeth()}>Wrap required test ETH to WETH</Button>}
                <Button className="kd-apply-button" disabled={mintBusy || mintConfirmed || wethBalance === null || usdcBalance === null || wethBalance < parseUnits(quote.split.ethAmount.toFixed(8), 18) || usdcBalance < parseUnits(quote.split.usdcAmount.toFixed(6), 6)} onClick={() => void mintOnChain()}>{mintBusy ? mintStep || "Confirming…" : mintConfirmed ? "Position minted" : "Mint position on Base Sepolia"} <ArrowRight size={14} /></Button>
              </>}
              {mintStep && !mintBusy && <small>{mintStep}</small>}{mintError && <p role="alert" className="mw-premium-warning">{mintError}</p>}
              {mintHash && <a href={basescanTx(mintHash)} target="_blank" rel="noreferrer">View mint transaction <ExternalLink size={13} /></a>}
              {mintConfirmed && !mintSaved && <Button variant="outline" disabled={mintBusy} onClick={() => void retryPositionRegistration()}>Retry portfolio registration</Button>}
              {mintTokenId && <strong>Uniswap position #{mintTokenId}</strong>}
              <small>A live mint needs both tokens. The faucet supplies nUSDC; wrap Base Sepolia ETH for WETH. No SwapVM route is active yet.</small>
            </div>
          </div>
        </Card> : <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Back fee coverage</h2><span>FINITE CAPACITY</span></div>
          <div className="mw-trade-inner">
            <p>Model how much capacity you would back for this range, then set your premium for the example LP position.</p>
            <div className="mw-underwriter-figures"><div><span>Live LP positions</span><strong>{selectedChainPositions.length}</strong></div><div><span>Coverage status</span><strong>Not active</strong></div></div>
            <AmountField label="Example LP position (USD)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <><div className="mw-quote"><div><span>Model premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Full payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Modeled payout</span><strong>{usd(quote.expectedPayoutUsd)}</strong></div><div><span>Edge risk</span><strong>{quote.edgeRiskPct}%</strong></div></div><p className="mw-risk-note">The full payout cap is at risk for each covered position. Historical pool fees are a proxy, so the expected payout can differ from this estimate.</p></>}
            <AmountField label="Capacity to model (nUSDC)" value={pledge} onChange={setPledge} min={1} />
            <AmountField label="Your premium for this example LP (USD)" value={premium} onChange={setPremium} min={0.01} />
            {quote && Number(premium) > 0 && <div className="mw-underwriter-sim"><div><span>Positions this capacity could fully back</span><strong>{quote.payoutCapUsd > 0 ? Math.floor(Number(pledge) / quote.payoutCapUsd) : 0}</strong></div><div><span>Modeled margin per position</span><strong>{usd(Number(premium) - quote.expectedPayoutUsd - (quote.premiumUsd - quote.expectedPayoutUsd - quote.underwriterMarginUsd))}</strong></div><div><span>Worst net payout per position</span><strong>{usd(Math.max(0, quote.payoutCapUsd - Number(premium)))}</strong></div><div><span>LP net floor at your premium</span><strong>{usd(quote.feeFloorUsd - Number(premium))}</strong></div></div>}
            {quote && Number(premium) > 0 && quote.feeFloorUsd - Number(premium) <= quote.alternative30DayUsd && <p className="mw-premium-warning">At this premium the LP net floor falls below the 6% annualized comparison rate. The quote may not attract LPs.</p>}
            {poolSlot && (poolSlot.priceUsd < lower || poolSlot.priceUsd >= upper) && <div className="mw-availability"><ShieldCheck size={15} /> The current on-chain price is outside this proposed range.</div>}
            <Button asChild variant="outline"><Link href="/dashboard/faucet">Get test nUSDC <ArrowRight size={14} /></Link></Button>
            <Link className="mw-evidence-link" href="/dashboard/backtest">Review six-month fee evidence <ArrowRight size={14} /></Link>
            <small className="mw-action-note">This calculator does not create a pledge or collect a premium. No underwriter collateral is locked.</small>
          </div>
        </Card>}
      </aside>
      </div>
      {role === "underwriter" && (risk
        ? <PoolRiskAnalysis report={risk} />
        : <Card className="kd-card mw-risk-loading"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Pool risk analysis</h2></div><div>{riskError || "Loading historical fee and coverage evidence…"}</div></Card>)}
    </div>}
  </div>;
}

export function WorkspacePortfolio({ role, walletAccount, onConnect }: {
  role: WorkspaceRole;
  walletAccount: string | null;
  onConnect: () => Promise<void>;
}) {
  const [positions, setPositions] = useState<ChainPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!walletAccount || role !== "lp") {
      queueMicrotask(() => setPositions([]));
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) { setPositions([]); setLoading(true); } });
    void api<{ positions: ChainPosition[] }>(`chain-positions?account=${encodeURIComponent(walletAccount)}`)
      .then(({ positions: rows }) => { if (active) { setPositions(rows); setError(""); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load positions."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [walletAccount, role]);

  const wethProvided = positions.reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const usdcProvided = positions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));

  if (role === "underwriter") {
    return <div className="mw-page">
      <div className="mw-banner"><CircleHelp size={16} /><p><strong>Backing portfolio</strong> · Only funded, on-chain coverage policies appear here. Pool risk models and proposed premiums do not count as backing.</p></div>
      <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Active coverage</h2><span>ON-CHAIN ONLY</span></div>
        <div className="mw-portfolio-empty"><ShieldCheck size={24} /><h2>No active coverage policies</h2><p>No funded policies are registered in this workspace. Explore a pool to compare range and fee risk.</p><Button asChild variant="outline"><Link href="/dashboard/pools">Explore pools <ArrowRight size={14} /></Link></Button></div>
      </Card>
    </div>;
  }

  return <div className="mw-page">
    <div className="mw-banner"><CircleHelp size={16} /><p><strong>LP portfolio</strong> · This page shows your verified Base Sepolia liquidity positions. Modeled deposits and cover requests are excluded.</p></div>
    {!walletAccount ? <Card className="kd-card mw-panel"><div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>Connect your wallet</h2><p>Your WETH/nUSDC positions will appear here after they are minted and verified.</p><Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={14} /></Button></div></Card> : <>
      <div className="mw-stats">
        <Card className="kd-card"><div className="mw-stat"><span>LIQUIDITY POSITIONS</span><strong>{positions.length}</strong><small>Verified Base Sepolia mints</small></div></Card>
        <Card className="kd-card"><div className="mw-stat"><span>WETH PROVIDED</span><strong>{Number(formatUnits(wethProvided, 18)).toFixed(5)}</strong><small>At mint</small></div></Card>
        <Card className="kd-card"><div className="mw-stat"><span>nUSDC PROVIDED</span><strong>{Number(formatUnits(usdcProvided, 6)).toFixed(2)}</strong><small>At mint</small></div></Card>
      </div>
      {error && <div className="mw-message is-error" role="alert">{error}</div>}
      <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Your LP positions</h2><span>{positions.length} ON-CHAIN</span></div>
        <div className="mw-position-list">{loading ? <div className="mw-portfolio-empty"><p>Loading your positions…</p></div> : positions.length ? positions.map((position) => <div className="mw-position" key={position.tokenId}>
          <TokenPairIcon pair="WETH / nUSDC" size="small" />
          <div><strong>Uniswap position #{position.tokenId}</strong><small>{Number(formatUnits(BigInt(position.wethRaw), 18)).toFixed(5)} WETH + {Number(formatUnits(BigInt(position.usdcRaw), 6)).toFixed(2)} nUSDC · {new Date(position.mintedAt).toLocaleDateString()}</small></div>
          <Button asChild variant="outline" size="sm"><a href={basescanTx(position.txHash)} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={13} /></a></Button>
        </div>) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No on-chain positions yet</h2><p>Mint a WETH/nUSDC position in the deployed pool to see it here.</p><Button asChild variant="outline"><Link href="/dashboard/pools">View pools <ArrowRight size={14} /></Link></Button></div>}</div>
      </Card>
    </>}
  </div>;
}

export function WorkspaceOverview({ role, walletAccount, onConnect }: {
  role: WorkspaceRole;
  walletAccount: string | null;
  onConnect: () => Promise<void>;
}) {
  const [positions, setPositions] = useState<ChainPosition[]>([]);
  const [allPositions, setAllPositions] = useState<ChainPosition[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([api<{ markets: Market[] }>("markets"), api<{ positions: ChainPosition[] }>("chain-positions")])
      .then(([directory, activity]) => { if (active) { setMarkets(directory.markets); setAllPositions(activity.positions); } })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load pools."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!walletAccount || role !== "lp") {
      queueMicrotask(() => setPositions([]));
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) setPositions([]); });
    void api<{ positions: ChainPosition[] }>(`chain-positions?account=${encodeURIComponent(walletAccount)}`)
      .then(({ positions: rows }) => { if (active) setPositions(rows); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Could not load positions."); });
    return () => { active = false; };
  }, [walletAccount, role]);

  const wethProvided = positions.reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const usdcProvided = positions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));
  const deployedPools = markets.filter((market) => market.deployment).length;
  const totalNusdcProvided = allPositions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));

  return <div className="mw-role-overview">
    <div className="mw-role-intro"><div><span>{role === "lp" ? "LIQUIDITY PROVIDER" : "UNDERWRITER"} / OVERVIEW</span><h2>{role === "lp" ? "Your liquidity at a glance" : "Your underwriting desk"}</h2><p>{role === "lp" ? "See verified testnet positions and find a pool to provide liquidity." : "Study pool fee history and risk before deciding what protection to quote."}</p></div><Button asChild variant="outline"><Link href={role === "lp" ? "/dashboard/pools" : "/dashboard/backtest"}>{role === "lp" ? "Explore pools" : "Open backtest"} <ArrowRight size={15} /></Link></Button></div>
    {error && <div className="mw-message is-error" role="alert">{error}</div>}
    <div className="mw-stats mw-role-stats">{role === "lp" ? <>
      <Card className="kd-card"><div className="mw-stat"><span>LIQUIDITY POSITIONS</span><strong>{walletAccount ? positions.length : "—"}</strong><small>Verified Base Sepolia mints</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>WETH PROVIDED</span><strong>{walletAccount ? Number(formatUnits(wethProvided, 18)).toFixed(5) : "—"}</strong><small>At mint</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>nUSDC PROVIDED</span><strong>{walletAccount ? Number(formatUnits(usdcProvided, 6)).toFixed(2) : "—"}</strong><small>At mint</small></div></Card>
    </> : <>
      <Card className="kd-card"><div className="mw-stat"><span>DEPLOYED POOLS</span><strong>{deployedPools}</strong><small>Base Sepolia</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>LIQUIDITY POSITIONS</span><strong>{allPositions.length}</strong><small>Verified Base Sepolia mints</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>nUSDC PROVIDED</span><strong>{Number(formatUnits(totalNusdcProvided, 6)).toFixed(2)}</strong><small>At mint, across deployed pools</small></div></Card>
    </>}</div>
    <Card className="kd-card mw-role-next"><div className="kd-card-heading"><h2>{role === "lp" ? <><PiggyBank size={16} /> Your next step</> : <><ShieldCheck size={16} /> Underwriting workflow</>}</h2><span>BASE SEPOLIA</span></div><div className="mw-role-next-inner"><h3>{role === "lp" ? walletAccount ? positions.length ? "Review your positions" : "Mint your first position" : "Connect to see your positions" : "Compare risk before backing"}</h3><p>{role === "lp" ? "Choose a deployed pool and price range, then mint a WETH/nUSDC position with your wallet. Fee income protection is not active yet." : "Review six months of pool volume and fee evidence, then model a premium for the range you want to back. No collateral is locked yet."}</p>{role === "lp" && !walletAccount ? <Button variant="outline" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={15} /></Button> : <Link href={role === "lp" ? positions.length ? "/dashboard/portfolio" : "/dashboard/pools" : "/dashboard/backtest"}>{role === "lp" ? positions.length ? "View portfolio" : "Browse pools" : "Study backtest"} <ArrowRight size={15} /></Link>}</div></Card>
  </div>;
}
