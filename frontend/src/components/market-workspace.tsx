"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, CircleHelp, Droplets, ExternalLink, PiggyBank, Plus, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { PoolPriceChart, type OraclePoint } from "@/components/pool-price-chart";
import { PoolRiskAnalysis, type RiskReport } from "@/components/pool-risk-analysis";
import { PoolRangeEditor } from "@/components/pool-range-editor";
import { baseClient, basescanTx, ensureBaseSepolia, erc20Abi, injectedClient, launcherAbi, mintParameters,
  NACRE_ADMIN, NACRE_LAUNCHER, NACRE_TEST_USDC, BASE_WETH, UNISWAP_PERMIT2,
  UNISWAP_POSITION_MANAGER, UNISWAP_STATE_VIEW, permit2Abi, positionManagerAbi,
  stateViewAbi, wethAbi, wethPriceToSqrtX96 } from "@/lib/nacre-chain";

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
type Position = {
  id: string; marketId: string; depositUsd: number; insured: boolean;
  feeFloorUsd: number; premiumUsd: number; payoutCapUsd: number; createdAt: string;
};
type Pledge = { id: string; marketId: string; capacityUsd: number; premiumUsd: number | null; exampleDepositUsd: number | null; createdAt: string };
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

export function WorkspacePools({ marketId, role, onRoleChange, walletAccount, onConnect }: { marketId?: string; role: WorkspaceRole; onRoleChange: (role: WorkspaceRole) => void; walletAccount: string | null; onConnect: () => Promise<void> }) {
  const participant = useParticipant();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [oraclePoints, setOraclePoints] = useState<OraclePoint[]>([]);
  const [livePrices, setLivePrices] = useState<LivePrices | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [selectedId, setSelectedId] = useState(marketId ?? "");
  const [quoteState, setQuoteState] = useState<{ marketId: string; data: Quote } | null>(null);
  const [riskState, setRiskState] = useState<{ marketId: string; depositUsd: number; lower: number; upper: number; data: RiskReport } | null>(null);
  const [riskError, setRiskError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [hasPoolDraft, setHasPoolDraft] = useState(false);
  const [deposit, setDeposit] = useState("1000");
  const [pledge, setPledge] = useState("100");
  const [simulatedPrice, setSimulatedPrice] = useState("");
  const [rangeLower, setRangeLower] = useState("");
  const [rangeUpper, setRangeUpper] = useState("");
  const [premium, setPremium] = useState("");
  const [launchBusy, setLaunchBusy] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [launchHash, setLaunchHash] = useState<Hex | null>(null);
  const [launcherLaunched, setLauncherLaunched] = useState<boolean | null>(null);
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
  const lower = Number(rangeLower || selected?.lowerPriceUsd);
  const upper = Number(rangeUpper || selected?.upperPriceUsd);
  const quote = quoteState?.marketId === selectedId && quoteState.data.depositUsd === Number(deposit)
    && quoteState.data.lowerPriceUsd === lower && quoteState.data.upperPriceUsd === upper
    ? quoteState.data : null;
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
    if (!marketId) return;
    let active = true;
    void baseClient.readContract({ address: NACRE_LAUNCHER, abi: launcherAbi, functionName: "launched" })
      .then((value) => { if (active) setLauncherLaunched(value); })
      .catch(() => { if (active) setLauncherLaunched(null); });
    return () => { active = false; };
  }, [marketId, refreshKey]);

  useEffect(() => {
    if (!marketId || !walletAccount) return;
    let active = true;
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
      }).catch(() => { if (active) { setLivePrices(null); setLiveError(true); } });
    };
    refresh();
    const timer = setInterval(refresh, 30_000);
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
  }, [refreshKey, marketId]);

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
  }, [marketId, selectedId, deposit, lower, upper, refreshKey]);

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
  }, [marketId, selectedId, role, deposit, lower, upper, refreshKey]);

  async function change<T>(request: () => Promise<T>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try { const result = await request(); setNotice(success); setRefreshKey((n) => n + 1); return result; }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Action failed"); return null; }
    finally { setBusy(false); }
  }

  async function pledgeCapacity() {
    if (!selected || !participant) return;
    await change(() => api(`markets/${selected.id}/pledges`, "POST", {
      participant, amountUsd: Number(pledge), premiumUsd: Number(premium), exampleDepositUsd: Number(deposit),
    }), "Sandbox underwriting interest recorded. No USDC was locked.");
  }

  async function invest(requestCover: boolean) {
    if (!selected || !participant) return;
    await change(() => api(`markets/${selected.id}/positions`, "POST", {
      participant, amountUsd: Number(deposit), requestCover,
      lowerPriceUsd: lower, upperPriceUsd: upper,
    }), requestCover ? "Covered sandbox position created." : "Sandbox LP position created.");
  }

  async function movePrice() {
    if (!selected) return;
    await change(() => api(`markets/${selected.id}/price`, "PATCH", {
      priceUsd: Number(simulatedPrice),
    }), "Sandbox tick updated. New coverage availability has been recalculated.");
  }

  async function syncOraclePrice() {
    if (!selected || !livePrices) return;
    await change(() => api(`markets/${selected.id}/oracle-sync`, "POST"),
      "Fresh oracle reference applied to the sandbox tick. Coverage availability was recalculated.");
  }

  async function recordLaunch(hash: Hex) {
    if (!selected) return;
    await api(`markets/${selected.id}/deployment`, "POST", { txHash: hash });
    setLaunchHash(hash);
    setRefreshKey((value) => value + 1);
  }

  async function launchPool() {
    if (!selected || !walletAccount || launchBusy) return;
    setLaunchBusy(true); setLaunchError("");
    try {
      if (walletAccount.toLowerCase() !== NACRE_ADMIN.toLowerCase()) throw new Error("Connect the configured Nacre admin wallet.");
      if (!selected.funded || !selected.inRange) throw new Error("Both funding targets and an in-range tick are required.");
      await ensureBaseSepolia();
      const wallet = injectedClient();
      const hash = await wallet.writeContract({ chain: wallet.chain, account: walletAccount as Address,
        address: NACRE_LAUNCHER, abi: launcherAbi, functionName: "initialize",
        args: [wethPriceToSqrtX96(selected.priceUsd)] });
      setLaunchHash(hash);
      localStorage.setItem(`nacre-launch-${selected.id}`, hash);
      const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("Pool initialization reverted. See the transaction on BaseScan.");
      await recordLaunch(hash);
      localStorage.removeItem(`nacre-launch-${selected.id}`);
      setLauncherLaunched(true);
    } catch (reason) { setLaunchError(reason instanceof Error ? reason.message : "Pool launch failed."); }
    finally { setLaunchBusy(false); }
  }

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
      setMintStep("Minting Uniswap v4 position NFT…");
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
      setMintStep("Position NFT minted on Base Sepolia.");
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
    <div className="mw-banner"><CircleHelp size={16} /><p><strong>Testnet workspace</strong> · Funding, underwriting interest, and fee coverage are sandbox records. Admin launch and LP mint use real Base Sepolia transactions. No coverage policy is active on-chain.</p></div>
    <div className="mw-heading"><div>{marketId && <Link className="mw-back-link" href="/dashboard/pools">← All pools</Link>}{marketId && selected ? <div className="mw-title-with-icon"><TokenPairIcon pair={selected.pair} size="large" /><h2>{selected.pair}</h2></div> : <h2>{marketId ? "Pool details" : "Pool directory"}</h2>}<p>{marketId ? "Review funding, range, and available protection before joining." : "Explore funded markets, then open a pool to provide liquidity or underwrite."}</p></div>{!marketId && <Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume pool draft" : "Create pool"}</Link></Button>}</div>
    {error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    {!marketId && !markets.length && <Card className="kd-card kd-empty-panel"><div className="kd-empty-panel-inner"><div className="kd-empty-art"><Droplets size={28} strokeWidth={1.4} /></div><Badge variant="outline">POOL DIRECTORY</Badge><h2>No Nacre pool drafts yet</h2><p>Create a sandbox market to test liquidity funding, underwriting interest, tick movement, and limited cover.</p><Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume saved draft" : "Create first pool"}</Link></Button></div></Card>}
    {!marketId && !!markets.length && <><div className="mw-directory-summary"><span>MARKETS <strong>{markets.length}</strong></span><span>LP CAPITAL <strong>{usd(markets.reduce((sum, market) => sum + market.investedUsd, 0))}</strong></span><span>AVAILABLE COVER <strong>{usd(markets.reduce((sum, market) => sum + market.coverRemainingUsd, 0))}</strong></span></div><div className="mw-directory-header"><h3>Available markets</h3><span>BASE SEPOLIA · WETH / nUSDC</span></div><div className="mw-directory-grid">{markets.map((market) => <Link key={market.id} href={`/dashboard/pools/${market.id}`} className="mw-directory-card"><div className="mw-directory-top"><TokenPairIcon pair={market.pair} size="large" /><Badge variant="outline">{market.status.replaceAll("_", " ")}</Badge></div><div><h3>{market.pair}</h3><p>{market.feeTier} fee · {usd(market.priceUsd)} / ETH</p></div><div className="mw-directory-metrics"><div><span>LP funded</span><strong>{usd(market.investedUsd)}</strong><small>of {usd(market.liquidityTargetUsd)}</small></div><div><span>Cover left</span><strong>{usd(market.coverRemainingUsd)}</strong><small>{usd(market.pledgedUsd)} pledged</small></div></div><div className="mw-directory-progress"><span>Liquidity funding</span><progress max={market.liquidityTargetUsd} value={market.investedUsd} /></div><div className="mw-directory-open">View pool <ArrowRight size={15} /></div></Link>)}</div></>}
    {marketId && !selected && !!markets.length && <Card className="kd-card mw-missing"><h3>Pool not found</h3><p>This market may have been removed from the local sandbox.</p><Link href="/dashboard/pools">Back to pool directory <ArrowRight size={15} /></Link></Card>}
    {marketId && selected && <div className="mw-pool-detail">
      <Card className="kd-card mw-overview-wide">
        <div className="kd-card-heading"><h2><Activity size={16} /> Pool overview</h2><Badge variant="outline">{selected.feeTier} FEE · SANDBOX</Badge></div>
        <div className="mw-overview-wide-inner">
          <div className="mw-overview-tiles">
            <div><span>SANDBOX POOL PRICE</span><strong>{usd(selected.priceUsd)}</strong><small>per WETH · tick {selected.currentTick}</small></div>
            <div><span>LIVE WETH / USDC</span><strong>{livePrices ? usd(livePrices.wethUsdc) : "—"}</strong><small>{livePrices ? `${livePrices.source} · ${new Date(livePrices.assets.WETH.publishedAt).toLocaleTimeString()}` : liveError ? "Oracle unavailable" : "Fetching oracle…"}</small></div>
            <div><span>LP CAPITAL</span><strong>{usd(selected.investedUsd)}</strong><small>of {usd(selected.liquidityTargetUsd)} target</small></div>
            <div><span>PROTECTION PLEDGED</span><strong>{usd(selected.pledgedUsd)}</strong><small>of {usd(selected.collateralBudgetUsd)} target</small></div>
            <div><span>COVER AVAILABLE</span><strong>{usd(selected.coverRemainingUsd)}</strong><small>{usd(selected.reservedUsd)} reserved</small></div>
          </div>
          <div className="mw-overview-range">
            <div><span>SELECTED LP RANGE</span><strong>{usd(selected.lowerPriceUsd)} <em>to</em> {usd(selected.upperPriceUsd)}</strong><small>ticks {selected.tickLower}–{selected.tickUpper}</small></div>
            <div className="mw-overview-range-track"><i style={{ left: `${Math.max(0, Math.min(100, (selected.priceUsd - selected.lowerPriceUsd) / (selected.upperPriceUsd - selected.lowerPriceUsd) * 100))}%` }} /></div>
            <Badge variant="outline" className={selected.inRange ? "is-in-range" : "is-out-of-range"}>{selected.inRange ? "SANDBOX IN RANGE" : "SANDBOX OUT OF RANGE"}</Badge>
          </div>
          <div className="mw-overview-oracle-foot">{livePrices ? <><span>Oracle inputs: WETH/USD {usd(livePrices.assets.WETH.usd)} · USDC/USD {usd(livePrices.assets.USDC.usd)}</span><a href={livePrices.sourceUrl} target="_blank" rel="noreferrer">{livePrices.source} feed <ArrowRight size={12} /></a></> : <span>{liveError ? "Fresh oracle inputs are unavailable; sandbox calculations retain their recorded tick." : "Checking live oracle inputs…"}</span>}</div>
        </div>
      </Card>
      <div className="mw-market-layout">
      <section className="mw-market-center" aria-label="Price and funding">
        <PoolPriceChart points={oraclePoints} livePrice={livePrices?.wethUsdc} publishedAt={livePrices?.assets.WETH.publishedAt} source={livePrices?.source} lower={selected.lowerPriceUsd} upper={selected.upperPriceUsd} current={selected.priceUsd} />
        <Card className="kd-card mw-funding-card">
          <div className="kd-card-heading"><h2><Droplets size={16} /> Launch funding</h2><Badge variant="outline">{selected.funded ? "BOTH SIDES FUNDED" : "FUNDING IN PROGRESS"}</Badge></div>
          <div className="mw-funding-inner">
            <div><span>LP liquidity</span><strong>{usd(selected.investedUsd)} <small>/ {usd(selected.liquidityTargetUsd)}</small></strong><progress value={selected.investedUsd} max={selected.liquidityTargetUsd} /></div>
            <div><span>Underwriter capacity</span><strong>{usd(selected.pledgedUsd)} <small>/ {usd(selected.collateralBudgetUsd)}</small></strong><progress value={selected.pledgedUsd} max={selected.collateralBudgetUsd} /></div>
            <p>A pool opens when both liquidity and protection are funded. Each covered position reserves its own payout cap.</p>
            <div className="mw-launch-gate">
              <div className="mw-launch-heading"><Rocket size={17} /><div><strong>Deploy Uniswap v4 pool</strong><small>Base Sepolia · WETH / nUSDC · Nacre hook</small></div></div>
              {selected.deployment ? <div className="mw-chain-success"><strong>Pool deployed</strong><span>Pool ID {selected.deployment.poolId.slice(0, 12)}…</span><a href={basescanTx(selected.deployment.txHash)} target="_blank" rel="noreferrer">View confirmed transaction <ExternalLink size={13} /></a></div>
                : <><div className="mw-launch-checks"><span className={selected.investedUsd >= selected.liquidityTargetUsd ? "is-passing" : ""}>LP target {selected.investedUsd >= selected.liquidityTargetUsd ? "✓" : "○"}</span><span className={selected.pledgedUsd >= selected.collateralBudgetUsd ? "is-passing" : ""}>Protection target {selected.pledgedUsd >= selected.collateralBudgetUsd ? "✓" : "○"}</span><span className={selected.inRange ? "is-passing" : ""}>Tick in range {selected.inRange ? "✓" : "○"}</span></div>
                  {!walletAccount ? <Button variant="outline" onClick={() => void onConnect()}>Connect admin wallet</Button>
                    : walletAccount.toLowerCase() !== NACRE_ADMIN.toLowerCase() ? <small className="mw-launch-wallet">Launch requires admin {NACRE_ADMIN.slice(0, 8)}…{NACRE_ADMIN.slice(-6)}.</small>
                    : <Button className="kd-apply-button" disabled={!selected.funded || !selected.inRange || launchBusy || launcherLaunched !== false} onClick={() => void launchPool()}>{launchBusy ? "Confirming deployment…" : launcherLaunched ? "Pool already initialized" : "Deploy pool on Base Sepolia"} <ArrowRight size={15} /></Button>}
                  {launchHash && <a className="mw-chain-link" href={basescanTx(launchHash)} target="_blank" rel="noreferrer">Transaction {launchHash.slice(0, 10)}… <ExternalLink size={13} /></a>}
                  {launchError && <div className="mw-message is-error" role="alert">{launchError}</div>}
                  {launchHash && launcherLaunched && !selected.deployment && <Button variant="outline" disabled={launchBusy} onClick={() => { setLaunchBusy(true); void recordLaunch(launchHash).then(() => setLaunchError("")).catch((reason) => setLaunchError(reason instanceof Error ? reason.message : "Could not reconcile launch.")).finally(() => setLaunchBusy(false)); }}>Retry launch confirmation</Button>}
                  <small>Funding above is recorded in the sandbox. Deployment initializes a real empty v4 pool; it does not transfer LP or underwriter tokens.</small></>}
            </div>
          </div>
        </Card>
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
            <p>Choose an amount and position range. Nacre updates the WETH / nUSDC split and estimated fee floor for those ticks.</p>
            <AmountField label="nUSDC to model (USD equivalent)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <>
              <div className="mw-split"><div><small>WETH required</small><strong>{usd(quote.split.swapUsd)}</strong><span>{quote.split.ethAmount} WETH</span></div><div><small>nUSDC required</small><strong>{usd(quote.split.usdcAmount)}</strong><span>{(100 - quote.split.ethPercent).toFixed(1)}% of deposit</span></div></div>
              <div className="mw-quote"><div><span>30-day fee floor</span><strong>{usd(quote.feeFloorUsd)}</strong></div><div><span>Indicative premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Backed payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Net fee floor</span><strong>{usd(quote.minimumNetFeesUsd)}</strong></div></div>
              <div className={`mw-availability${quote.available ? " is-open" : ""}`}><ShieldCheck size={15} /> {quote.available ? `Limited cover available · ${usd(selected.coverRemainingUsd)} left` : `No insurance available${quote.reasons.length ? `: ${quote.reasons.join(" ")}` : ""}`}</div>
            </>}
            <Button className="kd-apply-button" disabled={busy || !participant || !quote} onClick={() => void invest(false)}>Record LP simulation <ArrowRight size={15} /></Button>
            <Button variant="outline" disabled={busy || !participant || !quote?.available} onClick={() => void invest(true)}>Deposit with cover</Button>
            <Button asChild variant="outline"><Link href="/dashboard/faucet">Get 10,000 test nUSDC <ArrowRight size={14} /></Link></Button>
            <small className="mw-action-note">The two buttons above save a sandbox model. They do not move tokens.</small>
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
              {mintTokenId && <strong>Position NFT #{mintTokenId}</strong>}
              <small>A live mint needs both tokens. The faucet supplies nUSDC; wrap Base Sepolia ETH for WETH. No SwapVM route is active yet.</small>
            </div>
          </div>
        </Card> : <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Back fee coverage</h2><span>FINITE CAPACITY</span></div>
          <div className="mw-trade-inner">
            <p>Model how much capacity you would back for this range, then set your premium for the example LP position.</p>
            <div className="mw-underwriter-figures"><div><span>Pool capacity pledged</span><strong>{usd(selected.pledgedUsd)}</strong></div><div><span>Unreserved</span><strong>{usd(selected.coverRemainingUsd)}</strong></div></div>
            <AmountField label="Example LP position (USD)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <><div className="mw-quote"><div><span>Model premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Full payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Modeled payout</span><strong>{usd(quote.expectedPayoutUsd)}</strong></div><div><span>Edge risk</span><strong>{quote.edgeRiskPct}%</strong></div></div><p className="mw-risk-note">The full payout cap is at risk for each covered position. Historical pool fees are a proxy, so the expected payout can differ from this estimate.</p></>}
            <AmountField label="nUSDC capacity to pledge (sandbox USD)" value={pledge} onChange={setPledge} min={1} />
            <AmountField label="Your premium for this example LP (USD)" value={premium} onChange={setPremium} min={0.01} />
            {quote && Number(premium) > 0 && <div className="mw-underwriter-sim"><div><span>Positions this capacity could fully back</span><strong>{quote.payoutCapUsd > 0 ? Math.floor(Number(pledge) / quote.payoutCapUsd) : 0}</strong></div><div><span>Modeled margin per position</span><strong>{usd(Number(premium) - quote.expectedPayoutUsd - (quote.premiumUsd - quote.expectedPayoutUsd - quote.underwriterMarginUsd))}</strong></div><div><span>Worst net payout per position</span><strong>{usd(Math.max(0, quote.payoutCapUsd - Number(premium)))}</strong></div><div><span>LP net floor at your premium</span><strong>{usd(quote.feeFloorUsd - Number(premium))}</strong></div></div>}
            {quote && Number(premium) > 0 && quote.feeFloorUsd - Number(premium) <= quote.alternative30DayUsd && <p className="mw-premium-warning">At this premium the LP net floor falls below the 6% annualized comparison rate. The quote may not attract LPs.</p>}
            {!selected.inRange && <div className="mw-availability"><ShieldCheck size={15} /> No new coverage while the current tick is outside the range.</div>}
            <Button className="kd-apply-button" disabled={busy || !participant || !quote || Number(premium) <= 0 || Number(pledge) < quote.payoutCapUsd} onClick={() => void pledgeCapacity()}>Record underwriting proposal <ArrowRight size={15} /></Button>
            <Button asChild variant="outline"><Link href="/dashboard/faucet">Get test nUSDC <ArrowRight size={14} /></Link></Button>
            <Link className="mw-evidence-link" href="/dashboard/backtest">Review six-month fee evidence <ArrowRight size={14} /></Link>
            <small className="mw-action-note">No nUSDC is escrowed and no premium is collected in this sandbox.</small>
          </div>
        </Card>}
        <Card className="kd-card mw-trade-card mw-scenario-card">
          <div className="kd-card-heading"><h2><RefreshCw size={16} /> Price scenario</h2><span>MANUAL TICK</span></div>
          <div className="mw-trade-inner"><AmountField label="New WETH price (USD)" value={simulatedPrice} onChange={setSimulatedPrice} min={1} /><Button variant="outline" disabled={busy || !simulatedPrice} onClick={() => void movePrice()}>Record manual move</Button><Button variant="outline" disabled={busy || !livePrices} onClick={() => void syncOraclePrice()}>Use fresh oracle price <RefreshCw size={13} /></Button><small className="mw-action-note">Oracle sync re-reads the feed on the server and updates this shared sandbox tick. It does not settle an on-chain policy.</small></div>
        </Card>
      </aside>
      </div>
      {role === "underwriter" && (risk
        ? <PoolRiskAnalysis report={risk} capacityUsd={selected.pledgedUsd} reservedUsd={selected.reservedUsd} />
        : <Card className="kd-card mw-risk-loading"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Pool risk analysis</h2></div><div>{riskError || "Loading historical fee and coverage evidence…"}</div></Card>)}
    </div>}
  </div>;
}

export function WorkspacePortfolio({ role, walletAccount }: { role: WorkspaceRole; walletAccount: string | null }) {
  const participant = useParticipant();
  const [positions, setPositions] = useState<Position[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [chainPositions, setChainPositions] = useState<ChainPosition[]>([]);
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
  useEffect(() => {
    if (!walletAccount) return;
    let active = true;
    void api<{ positions: ChainPosition[] }>(`chain-positions?account=${encodeURIComponent(walletAccount)}`)
      .then(({ positions: rows }) => { if (active) setChainPositions(rows); })
      .catch(() => { if (active) setChainPositions([]); });
    return () => { active = false; };
  }, [walletAccount]);
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

  return <div className="mw-page"><div className="mw-banner"><CircleHelp size={16} /><p><strong>Portfolio</strong> · {role === "lp" ? "Base Sepolia position NFTs appear separately from sandbox deposits. Realized on-chain fees are not indexed yet." : "Underwriting proposals record interest only. No nUSDC is locked, and no premium or payout is recorded."}</p></div>
    {role === "lp" && walletAccount && <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Base Sepolia LP positions</h2><span>{chainPositions.length} ON-CHAIN</span></div><div className="mw-position-list">{chainPositions.length ? chainPositions.map((position) => <div className="mw-position" key={position.tokenId}><TokenPairIcon pair="WETH / nUSDC" size="small" /><div><strong>Position NFT #{position.tokenId}</strong><small>{Number(formatUnits(BigInt(position.wethRaw), 18)).toFixed(5)} WETH + {Number(formatUnits(BigInt(position.usdcRaw), 6)).toFixed(2)} nUSDC · {new Date(position.mintedAt).toLocaleDateString()}</small></div><Button asChild variant="outline" size="sm"><a href={basescanTx(position.txHash)} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={13} /></a></Button></div>) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No on-chain positions recorded</h2><p>Mint a WETH/nUSDC position from a deployed pool to see its verified NFT here.</p><Button asChild variant="outline"><Link href="/dashboard/pools">View pools <ArrowRight size={14} /></Link></Button></div>}</div></Card>}
    {role === "underwriter" ? <><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>CAPACITY PLEDGED</span><strong>{usd(pledged)}</strong><small>{pledges.length} sandbox {pledges.length === 1 ? "pledge" : "pledges"}</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>MARKETS BACKED</span><strong>{new Set(pledges.map((item) => item.marketId)).size}</strong><small>Sandbox pool drafts</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PREMIUM RECEIVED</span><strong>$0.00</strong><small>No active policy or payment</small></div></Card></div>{error && <div className="mw-message is-error" role="alert">{error}</div>}
      <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Your underwriting interest</h2><span>{pledges.length} {pledges.length === 1 ? "PLEDGE" : "PLEDGES"}</span></div><div className="mw-position-list">{pledges.length ? pledges.map((item) => { const market = markets.find((row) => row.id === item.marketId); return <div key={item.id} className="mw-position"><TokenPairIcon pair={market?.pair ?? "WETH / nUSDC"} size="small" /><div><strong>{market?.pair ?? "Pool draft"}</strong><small>{new Date(item.createdAt).toLocaleDateString()} · {item.premiumUsd ? `${usd(item.premiumUsd)} premium for ${usd(item.exampleDepositUsd ?? 0)} example` : "Premium not set"} · No collateral locked</small></div><strong>{usd(item.capacityUsd)}</strong><Button asChild variant="outline" size="sm"><Link href={`/dashboard/pools/${item.marketId}`}>View pool</Link></Button></div>; }) : <div className="mw-portfolio-empty"><ShieldCheck size={24} /><h2>No underwriting pledges yet</h2><p>Explore a pool, review its range and historical evidence, then record the capacity you would consider backing.</p><Button asChild variant="outline"><Link href="/dashboard/pools">Explore pools <ArrowRight size={15} /></Link></Button></div>}</div></Card></> : <><div className="mw-stats"><Card className="kd-card"><div className="mw-stat"><span>RECORDED CAPITAL</span><strong>{usd(invested)}</strong><small>{positions.length} sandbox positions</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>PROTECTED FLOOR</span><strong>{usd(protectedFloor)}</strong><small>30-day modeled total</small></div></Card><Card className="kd-card"><div className="mw-stat"><span>MODELED PREMIUM</span><strong>{usd(premium)}</strong><small>No payment collected</small></div></Card></div>{error && <div className="mw-message is-error" role="alert">{error}</div>}{notice && <div className="mw-message" role="status">{notice}</div>}
    <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Your sandbox positions</h2><span>{positions.length} POSITIONS</span></div><div className="mw-position-list">{positions.length ? positions.map((position) => { const market = markets.find((item) => item.id === position.marketId); return <div key={position.id} className="mw-position"><TokenPairIcon pair={market?.pair ?? "WETH / nUSDC"} size="small" /><div><strong>{market?.pair ?? "WETH / nUSDC"}</strong><small>{new Date(position.createdAt).toLocaleDateString()} · {position.insured ? `Covered floor ${usd(position.feeFloorUsd)}` : "Uncovered LP deposit"}</small></div><strong>{usd(position.depositUsd)}</strong>{position.insured ? <Badge variant="outline">COVER RECORDED</Badge> : <Button variant="outline" size="sm" disabled={busyId === position.id || !market?.inRange || !market?.funded} onClick={() => void addCover(position)}>{market?.inRange && market?.funded ? "Check cover" : "No cover available"}</Button>}</div>; }) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No sandbox positions yet</h2><p>Create a pool or join one from the Pools page. Your recorded deposits will appear here.</p><Button asChild variant="outline"><Link href="/dashboard/pools">Browse pools <ArrowRight size={15} /></Link></Button></div>}</div></Card>
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
