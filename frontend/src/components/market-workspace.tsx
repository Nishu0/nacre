"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { shortfallTotal } from "@/lib/shortfall";
import { Activity, ArrowRight, CircleHelp, Droplets, ExternalLink, PiggyBank, Plus, Rocket, ShieldCheck } from "lucide-react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TokenPairIcon } from "@/components/token-pair-icon";
import { PoolPriceChart } from "@/components/pool-price-chart";
import { PoolRiskAnalysis, type RiskReport } from "@/components/pool-risk-analysis";
import { CoverageFunding, CoverageRequestForm, CoverageBoard, CoverageStats } from "@/components/coverage-workspace";
import { savePendingCheckout, readPendingCheckout, clearPendingCheckout } from "@/lib/pending-checkout";
import { SWAPVM_CHECKOUT, swapVMAbi } from "@/lib/swapvm";
import { useSingleTokenQuote } from "@/lib/use-single-token-quote";
import { ATOMIC_CHECKOUT, atomicCheckoutAbi, atomicPurchase } from "@/lib/atomic-checkout";
import { positionMintError } from "@/lib/position-mint";
import { testPool, NACRE_TEST_WETH, type TestPoolConfig } from "@/lib/test-pools";
import { tickPrice, type CoverageOffer, type CoverageSnapshot } from "@/lib/coverage-contracts";
import { useHyperliquidPrice } from "@/lib/use-hyperliquid-price";
import { SupplyCostBreakdown } from "@/components/supply-cost-breakdown";
import { SupplyConfirmation, type SupplyReview, type SupplyPhase } from "@/components/supply-confirmation";
import { PoolRangeEditor } from "@/components/pool-range-editor";
import { baseClient, priceToRawTick, basescanTx, ensureBaseSepolia, erc20Abi, injectedClient, mintParameters,
  NACRE_TEST_USDC, BASE_WETH as CANONICAL_WETH,
  UNISWAP_STATE_VIEW,
  stateViewAbi, wethAbi, sqrtPriceX96ToWethUsd } from "@/lib/nacre-chain";

import { availableBid, bidCanProtectPosition, bidMatchesPosition } from "@/lib/funded-bids";
import { useCoverage } from "@/lib/use-coverage";

export type WorkspaceRole = "lp" | "underwriter";

export type Market = {
  archived: boolean; feeBps?: number; poolConfig?: TestPoolConfig;
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
type ChainPosition = { wethSymbol: string; poolId: string; tokenId: string; marketId: string; txHash: string; wethRaw: string; usdcRaw: string; mintedAt: string };
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

export function WorkspacePools({ marketId, bid, role, onRoleChange, walletAccount, onConnect, rangeChoices, hideHeading = false }: { marketId?: string; bid?: CoverageOffer; role: WorkspaceRole; onRoleChange: (role: WorkspaceRole) => void; walletAccount: string | null; onConnect: () => Promise<void>; rangeChoices?: ReactNode; hideHeading?: boolean }) {
  const router = useRouter();
  const { data: coverage, error: coverageError, refresh: refreshCoverage } = useCoverage(bid?.poolId);
  const activeBid = coverage?.offers.find((offer) => offer.address.toLowerCase() === bid?.address.toLowerCase());
  const [markets, setMarkets] = useState<Market[]>([]);
  const [chainPositions, setChainPositions] = useState<ChainPosition[]>([]);
  const [poolSlot, setPoolSlot] = useState<{ priceUsd: number; tick: number } | null>(null);
  const { points: oraclePoints, livePrices, liveError } = useHyperliquidPrice();
  const [selectedId, setSelectedId] = useState(marketId ?? "");
  const [quoteState, setQuoteState] = useState<{ marketId: string; data: Quote } | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [feePreviewState, setFeePreviewState] = useState<{ marketId: string; targetInput: string; data: FeePreview } | null>(null);
  const [feeError, setFeeError] = useState("");
  const [riskState, setRiskState] = useState<{ marketId: string; depositUsd: number; lower: number; upper: number; data: RiskReport } | null>(null);
  const [riskError, setRiskError] = useState("");
  const [error, setError] = useState("");
  const [hasPoolDraft, setHasPoolDraft] = useState(false);
  const [deposit, setDeposit] = useState("1000");
  const [coverageDays, setCoverageDays] = useState(bid ? bid.duration / 86400 : 30);
  const [feeTargetInput, setFeeTargetInput] = useState("");
  const [pledge, setPledge] = useState("100");
  const [selectedRange, setSelectedRange] = useState<{ marketId: string; lower: number; upper: number } | null>(null);
  const [premium, setPremium] = useState("");
  const [wethBalance, setWethBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const [tokenRefresh, setTokenRefresh] = useState(0);
  const [mintBusy, setMintBusy] = useState(false);
  const [mintStep, setMintStep] = useState("");
  const [mintError, setMintError] = useState("");
  const [mintHash, setMintHash] = useState<Hex | null>(null);
  const [mintTokenId, setMintTokenId] = useState<string | null>(null);
  const [mintConfirmed, setMintConfirmed] = useState(false);
  const [mintSaved, setMintSaved] = useState(false);
  const [supplyOpen, setSupplyOpen] = useState(false);
  const checkoutAbi = [...atomicCheckoutAbi, ...swapVMAbi] as const;
  const [singleToken, setSingleToken] = useState(false);
  const [supplyReview, setSupplyReview] = useState<SupplyReview | null>(null);
  const [supplyPhase, setSupplyPhase] = useState<SupplyPhase>("review");
  const supplyLock = useRef(false);
  const selected = markets.find((market) => market.id === selectedId);
  const poolConfig = selected?.poolConfig ?? testPool(selected?.deployment?.poolId);
  const BASE_WETH = poolConfig?.weth ?? CANONICAL_WETH;
  const wethSymbol = poolConfig?.symbol ?? "WETH";
  const isTestWeth = poolConfig?.weth === NACRE_TEST_WETH;
  const deployedPoolId = selected?.deployment?.poolId;
  const selectedChainPositions = chainPositions.filter((position) => position.marketId === selectedId);
  const selectedWeth = selectedChainPositions.reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const selectedUsdc = selectedChainPositions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));
  const exactBid = !!bid && !bid.supportsSubranges;
  const lower = exactBid ? tickPrice(bid.tickLower) : selectedRange?.marketId === selectedId ? selectedRange.lower : bid ? tickPrice(bid.tickLower) : selected?.lowerPriceUsd ?? 0;
  const upper = exactBid ? tickPrice(bid.tickUpper) : selectedRange?.marketId === selectedId ? selectedRange.upper : bid ? tickPrice(bid.tickUpper) : selected?.upperPriceUsd ?? 0;
  const referencePrice = livePrices?.wethUsdc ?? poolSlot?.priceUsd ?? selected?.priceUsd ?? 0;
  const referenceSource = livePrices ? liveError ? "LAST ETH PRICE" : "LIVE ETH PRICE"
    : poolSlot ? "ON-CHAIN POOL PRICE" : "PROPOSED PRICE";
  const quote = quoteState?.marketId === selectedId && quoteState.data.depositUsd === Number(deposit)
    && quoteState.data.lowerPriceUsd === lower && quoteState.data.upperPriceUsd === upper
    ? quoteState.data : null;
  const feePreview = feePreviewState?.marketId === selectedId
    && feePreviewState.data.principalUsd === Number(deposit)
    && feePreviewState.data.windowDays === coverageDays
    && feePreviewState.targetInput === feeTargetInput ? feePreviewState.data : null;
  const capacity = activeBid ? Math.min(Number(formatUnits(BigInt(activeBid.unreservedCapital ?? activeBid.available), 6)), activeBid.capPerPosition ? Number(formatUnits(BigInt(activeBid.capPerPosition), 6)) : Infinity) : 0;
  const feeTarget = feePreview ? (bid && !feeTargetInput.trim() ? Math.min(feePreview.feeTargetUsd, capacity) : feePreview.feeTargetUsd) : undefined;
  const feeCap = feeTarget && Number.isFinite(feeTarget) && feeTarget > 0 ? parseUnits(feeTarget.toFixed(6), 6) : 0n;
  const protectionPremium = activeBid && !coverageError && feeCap > 0n && Number.isInteger(activeBid.premiumBps) && activeBid.premiumBps > 0
    ? (feeCap * BigInt(activeBid.premiumBps) + 9999n) / 10000n : null;
  const positionRange = { poolId: bid?.poolId ?? deployedPoolId ?? "", tickLower: lower > 0 ? priceToRawTick(lower) : 0, tickUpper: upper > 0 ? priceToRawTick(upper) : 0 };
  const rangeMatchesBid = !!activeBid && bidMatchesPosition(activeBid, positionRange);
  const positionInRange = !!coverage && coverage.currentTick >= positionRange.tickLower && coverage.currentTick < positionRange.tickUpper;
  const bidReady = !!activeBid && !!coverage && !coverageError && bidCanProtectPosition(activeBid, positionRange, coverage.currentTick, walletAccount, feeCap);
  const rangeWarning = coverageError || (!bid ? "Choose a funded bid before supplying."
    : !coverage ? "Checking funded protection…"
    : !activeBid ? "This bid is no longer available. Choose another funded range."
    : activeBid.owner.toLowerCase() === walletAccount?.toLowerCase() ? "This wallet owns the bid. Use another wallet to supply against it."
    : activeBid.closed ? "This bid has closed. Choose another funded range."
    : activeBid.availableSpots === 0 ? "All spots in this bid are taken. Choose another funded range."
    : !rangeMatchesBid ? activeBid.supportsSubranges
      ? "Supply unavailable: your range extends outside this bid’s funded boundaries. Choose a narrower range or another bid."
      : "This existing bid requires its exact range. Reset to the bid range, or select a bid that supports narrower ranges."
    : !positionInRange ? "Supply unavailable: the current pool price is outside your selected range. Coverage cannot start for this position."
    : !feePreview ? feeError || "Calculating your protected fee target…"
    : feeCap <= 0n ? "This bid has no available fee protection for this amount. Choose another bid or adjust the amount."
    : !bidReady ? "This bid does not have enough available protection for your fee cap. Lower the fee target or choose another bid." : "");
  const requiredWeth = quote ? parseUnits(quote.split.ethAmount.toFixed(8), 18) : 0n;
  const requiredUsdc = quote ? parseUnits(quote.split.usdcAmount.toFixed(6), 6) : 0n;
  const singleQuote = useSingleTokenQuote(singleToken, BASE_WETH, requiredWeth, tokenRefresh);
  const swapQuote = singleQuote.quote;
  const singleTotal = requiredUsdc + (protectionPremium ?? 0n) + BigInt(swapQuote?.maxInput ?? "0");
  const supplyBlocker = !BigInt(ATOMIC_CHECKOUT) ? "Atomic supply and protection is not configured yet."
    : activeBid?.checkoutIndex === undefined ? "Choose a bid that supports atomic supply and protection."
    : !selected?.deployment ? "This pool has not been initialized."
    : !Number.isFinite(Number(deposit)) || Number(deposit) < 100 || Number(deposit) > 1_000_000 ? "Enter a position amount between $100 and $1,000,000."
    : !quote ? quoteError || "Calculating the tokens needed for this range…"
    : rangeWarning ? rangeWarning
    : balanceError ? balanceError
    : wethBalance === null || usdcBalance === null ? "Loading your wallet’s token balances…"
    : singleToken && (singleQuote.error || !swapQuote) ? singleQuote.error || "Getting a fresh swap quote…"
    : singleToken && usdcBalance < singleTotal ? `You need ${formatUnits(singleTotal - usdcBalance, 6)} more nUSDC for the swap, deposit and premium.`
    : !singleToken && wethBalance < requiredWeth ? `You need ${formatUnits(requiredWeth - wethBalance, 18)} more ${wethSymbol}. Get test tokens or lower your position amount.`
    : usdcBalance < requiredUsdc + (protectionPremium ?? 0n) ? `You need ${formatUnits(requiredUsdc + (protectionPremium ?? 0n) - usdcBalance, 6)} more nUSDC for supply and protection. Get test tokens or lower your position amount.`
    : "";
  useEffect(() => {
    if (!walletAccount || !deployedPoolId) return;
    const pending = readPendingCheckout(walletAccount, deployedPoolId);
    if (!pending) return;
    queueMicrotask(() => {
      setSupplyReview(pending.review); setMintHash(pending.hash); setMintConfirmed(false);
      setMintSaved(false); setSupplyPhase("supply"); setSupplyOpen(true);
      setMintStep("A previous checkout is pending. Check its status before submitting again.");
    });
  }, [walletAccount, deployedPoolId]);
  async function requireAvailableBid(review: SupplyReview) {
    if (!bid || !review.feeCap || BigInt(review.feeCap) <= 0n) throw new Error("Choose a funded bid and a positive fee target first.");
    const fresh = await api<CoverageSnapshot>(`coverage?fresh=1&poolId=${bid.poolId}`);
    const offer = fresh.offers.find((row) => row.address.toLowerCase() === bid.address.toLowerCase());
    const range = { poolId: review.poolId, tickLower: priceToRawTick(review.lower), tickUpper: priceToRawTick(review.upper) };
    if (!offer || !bidCanProtectPosition(offer, range, fresh.currentTick, review.account, BigInt(review.feeCap))) throw new Error("This range no longer has available protection. Check its bounds, current price, and funded bid capacity before supplying.");
  }
  const risk = riskState?.marketId === selectedId && riskState.depositUsd === Number(deposit)
    && riskState.lower === lower && riskState.upper === upper
    ? riskState.data : null;

  useEffect(() => {
    if (!marketId) queueMicrotask(() => setHasPoolDraft(Boolean(localStorage.getItem("nacre-pool-create-draft-v1"))));
  }, [marketId]);

  useEffect(() => {
    if (!marketId || !walletAccount) {
      queueMicrotask(() => { setWethBalance(null); setUsdcBalance(null); setBalanceError(""); });
      return;
    }
    let active = true;
    queueMicrotask(() => { if (active) { setWethBalance(null); setUsdcBalance(null); setBalanceError(""); } });
    void Promise.all([
      baseClient.readContract({ address: BASE_WETH, abi: erc20Abi, functionName: "balanceOf", args: [walletAccount as Address] }),
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [walletAccount as Address] }),
    ]).then(([weth, usdc]) => { if (active) { setWethBalance(weth); setUsdcBalance(usdc); } })
      .catch(() => { if (active) { setWethBalance(null); setUsdcBalance(null); setBalanceError("Could not load your token balances from Base Sepolia. Retry the supply checks."); } });
    return () => { active = false; };
  }, [marketId, walletAccount, tokenRefresh, BASE_WETH]);

  useEffect(() => {
    if (!walletAccount) return;
    // Recheck after returning from the faucet or wallet extension.
    const refresh = () => setTokenRefresh((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [walletAccount]);

  useEffect(() => {
    const controller = new AbortController();
    void (bid ? api<{ market: Market }>(`bid-market?poolId=${bid.poolId}`).then(({ market }) => ({ markets: [market] })) : api<{ markets: Market[] }>("markets")).then(({ markets: rows }) => {
      if (controller.signal.aborted) return;
      setMarkets(rows);
      setSelectedId((current) => marketId || current || rows[0]?.id || "");
      if (marketId && !rows.some((market) => market.id === marketId)) {
        void api<{ market: Market }>(`markets/${marketId}`).then(({ market }) => {
          if (!controller.signal.aborted && market.archived) {
            router.replace(rows.length === 1 ? `/dashboard/pools/${rows[0].id}` : "/dashboard/pools");
          }
        }).catch(() => { /* An unknown pool keeps the existing not-found state. */ });
      }
    }).catch((reason) => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [marketId, router, bid]);

  useEffect(() => {
    let active = true;
    void api<{ positions: ChainPosition[] }>("chain-positions")
      .then(({ positions: rows }) => { if (active) setChainPositions(rows); })
      .catch(() => { if (active) setChainPositions([]); });
    return () => { active = false; };
  }, [tokenRefresh]);

  useEffect(() => {
    if (!deployedPoolId) {
      queueMicrotask(() => setPoolSlot(null));
      return;
    }
    let active = true;
    const poolId = deployedPoolId as Hex;
    const refresh = () => {
      void baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi,
        functionName: "getSlot0", args: [poolId] })
        .then(([sqrtPriceX96, tick]) => {
          if (active) setPoolSlot({ priceUsd: sqrtPriceX96ToWethUsd(sqrtPriceX96), tick });
        })
        .catch(() => { if (active) setPoolSlot(null); });
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [deployedPoolId]);

  useEffect(() => {
    if (!marketId || !selectedId || !Number(deposit) || !lower || !upper || lower >= upper) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setQuoteError("");
      void api<{ quote: Quote }>(`markets/${selectedId}/quote?depositUsd=${encodeURIComponent(deposit)}&lowerPriceUsd=${encodeURIComponent(lower)}&upperPriceUsd=${encodeURIComponent(upper)}`)
        .then((data) => { if (!controller.signal.aborted) setQuoteState({ marketId: selectedId, data: data.quote }); })
        .catch((reason) => { if (!controller.signal.aborted) { setQuoteState(null); setQuoteError(reason instanceof Error ? reason.message : "Could not calculate the token amounts. Retry the supply checks."); } });
    }, 180);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [marketId, selectedId, deposit, lower, upper, tokenRefresh]);

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
  }, [marketId, selectedId, deposit, coverageDays, feeTargetInput, tokenRefresh]);

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
    if (!walletAccount || !quote || mintBusy || isTestWeth) return;
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

  async function approveForCheckout(token: Address, amount: bigint, account: Address, spender: Address = ATOMIC_CHECKOUT) {
    const wallet = injectedClient();
    const tokenLabel = token.toLowerCase() === BASE_WETH.toLowerCase() ? wethSymbol : "nUSDC";
    const allowance = await baseClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
    if (allowance >= amount) return;
    const [connected] = await wallet.getAddresses();
    if (connected?.toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Switch back before approving.");
    setMintStep(`Approve ${tokenLabel} for supply and protection…`);
    const tx = await wallet.writeContract({ chain: wallet.chain, account, address: token,
      abi: erc20Abi, functionName: "approve", args: [spender, amount] });
    const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`${tokenLabel} approval reverted.`);
  }

  function reviewSupply() {
    if (mintHash || mintConfirmed) { setSupplyOpen(true); return; }
    if (!selected?.deployment || !quote || !walletAccount || supplyBlocker) return;
    setSupplyReview({ singleToken: singleToken && swapQuote ? { ...swapQuote } : undefined, account: walletAccount, marketId: selected.id, poolId: selected.deployment.poolId,
      token: BASE_WETH, symbol: wethSymbol, fee: selected.feeBps ?? 500, lower, upper,
      wethAmount: quote.split.ethAmount, usdcAmount: quote.split.usdcAmount, total: quote.depositUsd, feeCap: String(feeCap), premiumUnits: protectionPremium?.toString() ?? null, premiumBps: activeBid?.premiumBps, offer: activeBid?.address, offerIndex: activeBid?.checkoutIndex, durationDays: coverageDays });
    setSupplyPhase("review"); setMintError(""); setMintStep("");
    setSupplyOpen(true);
  }

  async function finishSupply(tx: Hex, review: SupplyReview) {
    setSupplyPhase("supply"); setMintStep("Waiting for supply and protection to confirm…");
    let replaced = false;
    const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000,
      onReplaced: ({ reason }) => { if (reason !== "repriced") replaced = true; },
    });
    if (replaced) {
      clearPendingCheckout(review); setMintHash(null); setSupplyPhase("review");
      throw new Error("The supply transaction was cancelled or replaced. Review your wallet before trying again.");
    }
    if (receipt.status !== "success") {
      clearPendingCheckout(review); setMintHash(null); setSupplyPhase("review");
      throw new Error("Supply reverted. No liquidity was supplied and no premium was paid. You can try again.");
    }
    const purchase = atomicPurchase(receipt.logs, review.account);
    if (!purchase || purchase.offer.toLowerCase() !== review.offer?.toLowerCase()) throw new Error("The receipt does not confirm atomic protection. Check the transaction before continuing.");
    setMintHash(receipt.transactionHash);
    setMintConfirmed(true); setSupplyPhase("done");
    void refreshCoverage();
    setMintStep("Supply and protection confirmed. Updating your portfolio…");
    setTokenRefresh((value) => value + 1);
    const recorded = await api<{ tokenId: string }>(`markets/${review.marketId}/chain-positions`, "POST", { txHash: receipt.transactionHash, account: review.account });
    setMintTokenId(recorded.tokenId); setMintSaved(true); clearPendingCheckout(review);
    setTokenRefresh((value) => value + 1);
    setMintStep(`Position #${recorded.tokenId} added to your portfolio.`);
  }

  async function mintOnChain() {
    if (!supplyReview || supplyLock.current || mintConfirmed) return;
    supplyLock.current = true;
    setMintBusy(true); setMintError("");
    try {
      // A pending submission must be checked, never sent a second time.
      if (mintHash) { await finishSupply(mintHash, supplyReview); return; }
      const review = supplyReview;
      setSupplyPhase("approval"); setMintStep("Checking your wallet and token balances…");
      await ensureBaseSepolia();
      await requireAvailableBid(review);
      const account = review.account as Address;
      const [connected] = await injectedClient().getAddresses();
      if (connected?.toLowerCase() !== account.toLowerCase()) throw new Error("Switch back to the wallet used to review this supply.");
      const wethAmount = parseUnits(review.wethAmount.toFixed(8), 18);
      const usdcAmount = parseUnits(review.usdcAmount.toFixed(6), 6);
      if (!review.offer || review.offerIndex === undefined || !review.premiumUnits || !review.feeCap) throw new Error("Review a funded bid and premium first.");
      const premiumAmount = BigInt(review.premiumUnits);
      const single = review.singleToken;
      if (single && (single.expiresAt <= Date.now() / 1000 || BigInt(single.amountOut) !== wethAmount)) throw new Error("Swap quote expired. Close this review and refresh before confirming.");
      const totalUsdc = usdcAmount + premiumAmount + BigInt(single?.maxInput ?? "0");
      const [weth, usdc, slot] = await Promise.all([
        baseClient.readContract({ address: review.token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        baseClient.readContract({ address: UNISWAP_STATE_VIEW, abi: stateViewAbi, functionName: "getSlot0", args: [review.poolId as Hex] }),
      ]);
      if (!single && weth < wethAmount) throw new Error(`Insufficient ${review.symbol}. Get test tokens from the faucet first.`);
      if (usdc < totalUsdc) throw new Error("Insufficient nUSDC for deposit plus premium. Get test tokens from the faucet first.");
      if (slot[0] === 0n) throw new Error("The Uniswap pool has not been initialized.");
      const params = mintParameters({ fee: review.fee, sqrtPriceX96: slot[0], lowerPriceUsd: review.lower,
        upperPriceUsd: review.upper, wethAmount, usdcAmount, recipient: account, wethToken: review.token });
      if (!single) await approveForCheckout(review.token, wethAmount, account);
      await approveForCheckout(NACRE_TEST_USDC, totalUsdc, account, single ? SWAPVM_CHECKOUT : ATOMIC_CHECKOUT);
      if (single && single.expiresAt <= Date.now() / 1000) throw new Error("Swap quote expired during approval. Close this review and refresh. No supply was submitted.");
      await requireAvailableBid(review);
      setSupplyPhase("supply"); setMintStep("Checking the transaction and estimating gas…");
      const checkoutTerms = { key: { currency0: review.token, currency1: NACRE_TEST_USDC,
        fee: review.fee, tickSpacing: 10, hooks: "0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00" as Address },
        offer: review.offer as Address, offerIndex: BigInt(review.offerIndex), tickLower: params.lowerTick, tickUpper: params.upperTick,
        liquidity: params.liquidity, amount0Max: params.amount0Max, amount1Max: params.amount1Max,
        feeCap: BigInt(review.feeCap), maxPremium: premiumAmount, deadline: BigInt(single ? single.expiresAt : Math.floor(Date.now() / 1000) + 600) };
      const call = single
        ? { account, address: SWAPVM_CHECKOUT, abi: checkoutAbi, functionName: "supplyWithUSDC" as const, args: [checkoutTerms, BigInt(single.maxInput), single.orderHash] as const }
        : { account, address: ATOMIC_CHECKOUT, abi: checkoutAbi, functionName: "supplyAndProtect" as const, args: [checkoutTerms] as const };
      const estimate = call.functionName === "supplyWithUSDC"
        ? await baseClient.estimateContractGas(call) : await baseClient.estimateContractGas(call);
      const gas = estimate * 130n / 100n + 25000n;
      if (gas > 6_000_000n) throw new Error("Checkout gas exceeds the app limit. Refresh your quote and try again.");
      if (call.functionName === "supplyWithUSDC") await baseClient.simulateContract({ ...call, gas });
      else await baseClient.simulateContract({ ...call, gas });
      setMintStep("Confirm supply and protection in your wallet…");
      const wallet = injectedClient();
      const [currentAccount] = await wallet.getAddresses();
      if (currentAccount?.toLowerCase() !== account.toLowerCase()) throw new Error("Wallet changed. Switch back before supplying.");
      const tx = call.functionName === "supplyWithUSDC"
        ? await wallet.writeContract({ ...call, gas, chain: wallet.chain })
        : await wallet.writeContract({ ...call, gas, chain: wallet.chain });
      setMintHash(tx); savePendingCheckout(tx, review);
      await finishSupply(tx, review);
    } catch (reason) { setMintError(positionMintError(reason).replace(/minting/gi, "supplying").replace(/mint/gi, "supply")); }
    finally { supplyLock.current = false; setMintBusy(false); }
  }

  async function retryPositionRegistration() {
    if (!supplyReview || !mintHash || supplyLock.current) return;
    supplyLock.current = true;
    setMintBusy(true); setMintError("");
    try {
      setMintStep("Updating your portfolio…");
      const recorded = await api<{ tokenId: string }>(`markets/${supplyReview.marketId}/chain-positions`, "POST",
        { txHash: mintHash, account: supplyReview.account });
      setMintTokenId(recorded.tokenId); setMintSaved(true); clearPendingCheckout(supplyReview);
      setTokenRefresh((value) => value + 1);
      setMintStep(`Position #${recorded.tokenId} added to your portfolio.`);
    }
    catch (reason) { setMintError(reason instanceof Error ? reason.message : "Could not update your portfolio."); }
    finally { supplyLock.current = false; setMintBusy(false); }
  }

  return <div className="mw-page">
    <SupplyConfirmation open={supplyOpen} onOpenChange={setSupplyOpen} review={supplyReview} phase={supplyPhase}
      busy={mintBusy} message={mintStep} error={mintError} hash={mintHash} saved={mintSaved}
      onConfirm={() => void mintOnChain()} onRegister={() => void retryPositionRegistration()} />
    {!hideHeading && <div className="mw-heading"><div>{marketId && <Link className="mw-back-link" href="/dashboard/pools">← All pools</Link>}{marketId && selected ? <div className="mw-title-with-icon"><TokenPairIcon pair={selected.pair} size="large" /><h2>{selected.pair}</h2></div> : <h2>{marketId ? "Pool details" : "Pool directory"}</h2>}<p>{marketId ? "Supply liquidity in your selected bid’s range." : "Explore market proposals and deployed pools."}</p></div>{marketId && selected?.deployment ? <a className="mw-initialized-link" href={basescanTx(selected.deployment.txHash)} target="_blank" rel="noreferrer" aria-label="Initialized on Base Sepolia, view deployment transaction">Initialized <ExternalLink size={16} /></a> : marketId && selected ? <Badge variant="outline" className="mw-proposal-badge">Proposal</Badge> : <Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume pool draft" : "Create pool"}</Link></Button>}</div>}
    {error && <div className="mw-message is-error" role="alert">{error}</div>}
    {!marketId && !markets.length && <Card className="kd-card kd-empty-panel"><div className="kd-empty-panel-inner"><div className="kd-empty-art"><Droplets size={28} strokeWidth={1.4} /></div><Badge variant="outline">POOL DIRECTORY</Badge><h2>No Nacre markets yet</h2><p>Create a market proposal to define a pair, range, and launch targets.</p><Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={15} /> {hasPoolDraft ? "Resume saved draft" : "Create first pool"}</Link></Button></div></Card>}
    {!marketId && !!markets.length && <>
      <div className="mw-directory-summary"><span>MARKETS <strong>{markets.length}</strong></span><span>DEPLOYED <strong>{markets.filter((market) => market.deployment).length}</strong></span><span>LIQUIDITY POSITIONS <strong>{chainPositions.filter((position) => markets.some((market) => market.id === position.marketId)).length}</strong></span></div>
      <div className="mw-directory-header"><h3>Available markets</h3><span>BASE SEPOLIA · TEST POOLS</span></div>
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
            <div><span>ON-CHAIN POOL PRICE</span><strong>{poolSlot ? usd(poolSlot.priceUsd) : "—"}</strong><small>{poolSlot ? `per ${wethSymbol} · tick ${poolSlot.tick}` : "Available after deployment"}</small></div>
            <div><span>{liveError ? "LAST ETH PERP / USDC" : "LIVE ETH PERP / USDC"}</span><strong>{livePrices ? usd(livePrices.wethUsdc) : "—"}</strong><small>{livePrices ? `${livePrices.source} · ${new Date(livePrices.assets.WETH.publishedAt).toLocaleTimeString()}` : liveError ? "Live feed unavailable" : "Connecting live feed…"}</small></div>
            <div><span>LIQUIDITY POSITIONS</span><strong>{selectedChainPositions.length}</strong><small>Verified Base Sepolia mints</small></div>
            <div><span>{wethSymbol} PROVIDED</span><strong>{Number(formatUnits(selectedWeth, 18)).toFixed(5)}</strong><small>At mint</small></div>
            <div><span>nUSDC PROVIDED</span><strong>{Number(formatUnits(selectedUsdc, 6)).toFixed(2)}</strong><small>At mint</small></div>
          </div>
          <div className="mw-overview-range">
            <div><span>{bid ? "SELECTED LP RANGE" : "PROPOSED LP RANGE"}</span><strong>{usd(lower)} <em>to</em> {usd(upper)}</strong><small>{bid ? `${coverageDays} days · investor-selected bins` : "Choose your supply range"}</small></div>
            <div className="mw-overview-range-track"><i style={{ left: `${Math.max(0, Math.min(100, (referencePrice - lower) / (upper - lower) * 100))}%` }} /></div>
            <Badge variant="outline" className={referencePrice >= lower && referencePrice < upper ? "is-in-range" : "is-out-of-range"}>{referencePrice >= lower && referencePrice < upper ? "LIVE IN RANGE" : "LIVE OUT OF RANGE"}</Badge>
          </div>
          <div className="mw-overview-oracle-foot">{livePrices ? <><span>ETH perpetual market reference</span><a href={livePrices.sourceUrl} target="_blank" rel="noreferrer">{livePrices.source} feed <ArrowRight size={12} /></a></> : <span>{liveError ? "Live market prices are temporarily unavailable." : "Connecting to Hyperliquid…"}</span>}</div>
        </div>
      </Card>
      <div className="mw-market-layout">
      <section className="mw-market-center" aria-label="Price and funding">
        {role === "lp" && <Card className="kd-card mw-supply-card">
          <div className="kd-card-heading"><h2><PiggyBank size={16} /> Supply & protect</h2><span>BASE SEPOLIA</span></div>
          <div className="mw-supply-inner">
            <p>{singleToken ? "Supply nUSDC. We swap the portion your range needs into " + wethSymbol + ", then supply and activate fee protection together." : <>Choose your range, then supply {wethSymbol} and nUSDC with fee protection in one transaction.</>}</p>
            {rangeChoices && <fieldset className="supply-range-picker" disabled={mintBusy || supplyOpen || (!!mintHash && !mintConfirmed)}>{rangeChoices}</fieldset>}
            {bid && <fieldset className="supply-range-picker" disabled={mintBusy || supplyOpen || mintConfirmed || !!mintHash}>
              <div className="supply-range-summary"><span>Funded boundaries</span><strong>{usd(tickPrice(bid.tickLower))} – {usd(tickPrice(bid.tickUpper))}</strong></div>
              <PoolRangeEditor minimum={selected.lowerPriceUsd} maximum={selected.upperPriceUsd}
                current={poolSlot?.priceUsd ?? referencePrice} currentLabel="POOL PRICE" onChainPrice={poolSlot?.priceUsd}
                lower={lower} upper={upper}
                fundedRange={{ tickLower: bid.tickLower, tickUpper: bid.tickUpper, exact: exactBid }}
                locked={!activeBid || !coverage || !!coverageError || !availableBid(activeBid, coverage.currentTick, walletAccount)}
                onLower={(value) => setSelectedRange({ marketId: selectedId, lower: value, upper })}
                onUpper={(value) => setSelectedRange({ marketId: selectedId, lower, upper: value })}
                onCenter={() => {
                  const center = poolSlot?.priceUsd ?? referencePrice;
                  const low = Math.max(bid.tickLower, priceToRawTick(center * .98));
                  const high = Math.min(bid.tickUpper, priceToRawTick(center * 1.02));
                  if (low < high) setSelectedRange({ marketId: selectedId, lower: tickPrice(low), upper: tickPrice(high) });
                }} />
              {!exactBid && <button type="button" className="supply-secondary" disabled={!activeBid || !coverage || !!coverageError || !availableBid(activeBid, coverage.currentTick, walletAccount)} onClick={() => setSelectedRange({ marketId: selectedId, lower: tickPrice(bid.tickLower), upper: tickPrice(bid.tickUpper) })}>Use full bid range</button>}
            </fieldset>}
            {!mintConfirmed && <p className={rangeWarning ? "supply-error" : "supply-range-eligible"} role="status">{rangeWarning || "This range is eligible. Supply and fee protection activate together in one transaction."}</p>}
            <fieldset disabled={mintBusy || supplyOpen || mintConfirmed || !!mintHash}>
              <label htmlFor="supply-payment">Pay with</label>
              <select id="supply-payment" className="supply-secondary" value={singleToken ? "usdc" : "pair"} onChange={(event) => setSingleToken(event.target.value === "usdc")}>
                <option value="pair">{wethSymbol} + nUSDC</option>
                <option value="usdc">nUSDC only · swap included</option>
              </select>
              <AmountField label="Position amount (USD equivalent)" value={deposit} onChange={(value) => { setDeposit(value); setFeeTargetInput(""); }} min={100} />
            </fieldset>
            {singleToken && singleQuote.error && <p className="supply-error" role="status">{singleQuote.error}</p>}
            {singleToken && <div className="supply-review" aria-live="polite">
              <div><span>Swap nUSDC into {wethSymbol}</span><strong>{swapQuote ? formatUnits(BigInt(swapQuote.amountIn), 6) + " nUSDC" : singleQuote.error ? "Unavailable" : "Getting quote…"}</strong></div>
              <div><span>nUSDC for the LP position</span><strong>{formatUnits(requiredUsdc, 6)}</strong></div>
              <div><span>Protection premium</span><strong>{protectionPremium === null ? "Unavailable" : formatUnits(protectionPremium, 6) + " nUSDC"}</strong></div>
              <div><span>Maximum nUSDC payment · before gas</span><strong>{swapQuote ? formatUnits(singleTotal, 6) : "Unavailable"}</strong></div>
              <small>The position amount is your LP target. The maximum payment includes the premium and a 0.5% swap buffer. Unspent tokens return to your wallet. Gas is paid in ETH.</small>
            </div>}
            <div className="supply-token-grid">
              <div><span>{wethSymbol}</span><strong>{quote ? quote.split.ethAmount.toLocaleString("en-US", { maximumFractionDigits: 8 }) : "—"}</strong><small>Balance: {wethBalance === null ? "—" : Number(formatUnits(wethBalance, 18)).toLocaleString("en-US", { maximumFractionDigits: 8 })}</small></div>
              <div><span>nUSDC</span><strong>{quote ? quote.split.usdcAmount.toLocaleString("en-US", { maximumFractionDigits: 6 }) : "—"}</strong><small>Balance: {usdcBalance === null ? "—" : Number(formatUnits(usdcBalance, 6)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</small></div>
            </div>
            {!singleToken && bid && quote && <SupplyCostBreakdown positionValue={quote.depositUsd} usdcAmount={quote.split.usdcAmount}
              premiumUnits={protectionPremium?.toString() ?? null} feeCapUnits={feeCap > 0n ? String(feeCap) : undefined} balance={mintConfirmed ? null : usdcBalance} />}
            <div className="supply-range-summary"><span>Price range</span><strong>{usd(lower)} – {usd(upper)}</strong></div>
            {mintConfirmed && mintHash ? <>
              <a className="supply-primary" href={basescanTx(mintHash)} target="_blank" rel="noreferrer">Supplied & protected · {mintHash.slice(0, 8)}…{mintHash.slice(-6)} <ExternalLink size={16} /></a>
              <small>{mintTokenId ? `Position #${mintTokenId} is in your portfolio.` : "Supply and protection confirmed on-chain."}</small>
              {!mintSaved && <button className="supply-secondary" onClick={() => setSupplyOpen(true)}>View portfolio update</button>}
            </> : !walletAccount ? <button className="supply-primary" onClick={() => void onConnect()}>Connect wallet</button> : <>
              {!mintHash && supplyBlocker && <p id="supply-blocker" className="supply-error" role="status">{supplyBlocker}</p>}
              <button className="supply-primary" disabled={mintBusy || (!mintHash && !!supplyBlocker)} aria-describedby={!mintHash && supplyBlocker ? "supply-blocker" : undefined} onClick={reviewSupply}>{mintBusy ? "Supply & protect in progress…" : mintHash ? "Check transaction status" : "Supply & protect"} <ArrowRight size={16} /></button>
              {!mintHash && supplyBlocker && <button type="button" className="supply-secondary" disabled={mintBusy} onClick={() => { setTokenRefresh((value) => value + 1); void refreshCoverage(); }}>Retry supply checks</button>}
              {quote && ((wethBalance !== null && wethBalance < parseUnits(quote.split.ethAmount.toFixed(8), 18)) || (usdcBalance !== null && usdcBalance < parseUnits(quote.split.usdcAmount.toFixed(6), 6) + (protectionPremium ?? 0n))) && <Link className="supply-secondary" href="/dashboard/faucet">Get test tokens <ArrowRight size={16} /></Link>}
              {!singleToken && !isTestWeth && quote && wethBalance !== null && wethBalance < parseUnits(quote.split.ethAmount.toFixed(8), 18) && <button className="supply-secondary" disabled={mintBusy} onClick={() => void wrapWeth()}>Wrap test ETH to WETH</button>}
              {mintError && !supplyOpen && <p role="alert" className="supply-error">{mintError}</p>}
            </>}
          </div>
        </Card>}

        <PoolPriceChart points={oraclePoints} livePrice={livePrices?.wethUsdc} publishedAt={livePrices?.assets.WETH.publishedAt} source={livePrices?.source} lower={lower} upper={upper} current={poolSlot?.priceUsd ?? selected.priceUsd} stale={liveError} />
        {selected.deployment && <CoverageBoard poolId={selected.deployment.poolId} account={walletAccount} role={role} portfolio={!!bid} onChoose={!bid && role === "lp" ? (offer) => {
          setSelectedRange({ marketId: selectedId, lower: tickPrice(offer.tickLower), upper: tickPrice(offer.tickUpper) });
          setCoverageDays(offer.duration / 86400); setFeeTargetInput("");
        } : undefined} />}
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
        {bid ? <div className="mw-onchain-lp"><strong>Selected funded bid</strong><div className="cw-terms"><strong>{usd(tickPrice(bid.tickLower))} – {usd(tickPrice(bid.tickUpper))}</strong><span>{(bid.tickUpper - bid.tickLower) / 10} funded bins · {coverageDays} days</span><span>Available cover: {capacity.toFixed(4)} nUSDC</span><span>Premium: {bid.premiumBps / 100}% of your protected fee cap</span></div><small>{bid.supportsSubranges ? "Select any narrower range inside these boundaries. All ranges share this bid’s spots and capital." : "Existing fixed-range bid. Only its exact boundaries can be protected."}</small>{!bidReady && <p role="status">{coverageError || "Waiting for an available bid and a fee target within its capacity."}</p>}</div> : <PoolRangeEditor minimum={selected.lowerPriceUsd} maximum={selected.upperPriceUsd}
          current={referencePrice} currentLabel={referenceSource} onChainPrice={poolSlot?.priceUsd}
          lower={lower} upper={upper}
          onLower={(value) => setSelectedRange({ marketId: selectedId, lower: Math.max(selected.lowerPriceUsd, Math.min(value, upper - .01)), upper })}
          onUpper={(value) => setSelectedRange({ marketId: selectedId, lower, upper: Math.min(selected.upperPriceUsd, Math.max(value, lower + .01)) })}
          onCenter={referencePrice > selected.lowerPriceUsd && referencePrice < selected.upperPriceUsd ? () => {
            const halfWidth = referencePrice * .05;
            setSelectedRange({ marketId: selectedId,
              lower: Number(Math.max(selected.lowerPriceUsd, referencePrice - halfWidth).toFixed(2)),
              upper: Number(Math.min(selected.upperPriceUsd, referencePrice + halfWidth).toFixed(2)) });
          } : undefined} />}
        {role === "lp" ? <Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Fee protection</h2></div>
          <div className="mw-trade-inner">
            <p>Your selected fee cap and premium are included in Supply & protect. Existing unprotected positions can still buy coverage below.</p>
            <details className="supply-coverage-settings"><summary>Coverage settings</summary>
              <label className="mw-field"><span>Duration</span><select disabled={!!bid} value={coverageDays} onChange={(event) => { setCoverageDays(Number(event.target.value)); setFeeTargetInput(""); }}>{[7, 14, 30, 60, 90].map((days) => <option key={days} value={days}>{days} days</option>)}</select></label>
              <AmountField label="Fee cap (nUSDC)" value={feeTargetInput} onChange={setFeeTargetInput} min={0.01} />
              <small>{feeTarget ? `Current target: ${feeTarget.toFixed(2)} nUSDC` : "Calculating suggested target…"}. Leave blank to use the suggested target.</small>
            </details>
            {feeError && <p role="alert">{feeError}</p>}
            <details className="supply-coverage-settings"><summary>Protect an existing position</summary>
            <CoverageRequestForm bidAddress={bid?.address} poolId={selected.deployment?.poolId} key={walletAccount ?? "disconnected"} account={walletAccount} days={coverageDays}
              feeTarget={feeTarget} maximumTarget={feePreview ? Math.min(feePreview.maximumFeeTargetUsd, bid ? capacity : Infinity) : undefined} refreshKey={tokenRefresh} />
            </details>
          </div>
        </Card> : <><CoverageFunding poolId={selected.deployment?.poolId} key={walletAccount ?? "disconnected"} account={walletAccount} onConnect={onConnect} lower={lower} upper={upper} /><details className="cw-calculator"><summary>Historical risk calculator</summary><Card className="kd-card mw-trade-card">
          <div className="kd-card-heading"><h2><ShieldCheck size={16} /> Backtest estimates</h2><span>RESEARCH</span></div>
          <div className="mw-trade-inner">
            <p>Model how much capacity you would back for this range, then set your premium for the example LP position.</p>
            <div className="mw-underwriter-figures"><div><span>Live LP positions</span><strong>{selectedChainPositions.length}</strong></div><div><span>Calculator</span><strong>Research only</strong></div></div>
            <AmountField label="Example LP position (USD)" value={deposit} onChange={setDeposit} min={100} />
            {quote && <><div className="mw-quote"><div><span>Model premium</span><strong>{usd(quote.premiumUsd)}</strong></div><div><span>Full payout cap</span><strong>{usd(quote.payoutCapUsd)}</strong></div><div><span>Modeled payout</span><strong>{usd(quote.expectedPayoutUsd)}</strong></div><div><span>Edge risk</span><strong>{quote.edgeRiskPct}%</strong></div></div><p className="mw-risk-note">The full payout cap is at risk for each covered position. Historical pool fees are a proxy, so the expected payout can differ from this estimate.</p></>}
            <AmountField label="Capacity to model (nUSDC)" value={pledge} onChange={setPledge} min={1} />
            <AmountField label="Your premium for this example LP (USD)" value={premium} onChange={setPremium} min={0.01} />
            {quote && Number(premium) > 0 && <div className="mw-underwriter-sim"><div><span>Positions this capacity could fully back</span><strong>{quote.payoutCapUsd > 0 ? Math.floor(Number(pledge) / quote.payoutCapUsd) : 0}</strong></div><div><span>Modeled margin per position</span><strong>{usd(Number(premium) - quote.expectedPayoutUsd - (quote.premiumUsd - quote.expectedPayoutUsd - quote.underwriterMarginUsd))}</strong></div><div><span>Worst net payout per position</span><strong>{usd(Math.max(0, quote.payoutCapUsd - Number(premium)))}</strong></div><div><span>LP net floor at your premium</span><strong>{usd(quote.feeFloorUsd - Number(premium))}</strong></div></div>}
            {quote && Number(premium) > 0 && quote.feeFloorUsd - Number(premium) <= quote.alternative30DayUsd && <p className="mw-premium-warning">At this premium the LP net floor falls below the 6% annualized comparison rate. The quote may not attract LPs.</p>}
            {poolSlot && (poolSlot.priceUsd < lower || poolSlot.priceUsd >= upper) && <div className="mw-availability"><ShieldCheck size={15} /> The current on-chain price is outside this proposed range.</div>}
            <Button asChild variant="outline" className="mw-faucet-link"><Link href="/dashboard/faucet">Get test nUSDC <ArrowRight size={14} /></Link></Button>
            <Link className="mw-evidence-link" href="/dashboard/backtest">Review six-month fee evidence <ArrowRight size={14} /></Link>
            <small className="mw-action-note">These estimates do not change your funded offers. Use the coverage form above to deposit capital.</small>
          </div>
        </Card></details></>}
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
  const { data: portfolioCoverage, error: portfolioCoverageError, now: coverageNow } = useCoverage();
  const paidShortfall = walletAccount && portfolioCoverage && !portfolioCoverageError ? shortfallTotal(portfolioCoverage, walletAccount, "lp") : null;

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

  const nwethProvided = positions.filter((position) => position.wethSymbol === "nWETH").reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const usdcProvided = positions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));

  if (role === "underwriter") {
    return <div className="mw-page"><CoverageStats account={walletAccount} />
      {!walletAccount && <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet</Button>}
      <CoverageBoard account={walletAccount} role="underwriter" portfolio />
    </div>;
  }

  return <div className="mw-page">
    <div className="mw-banner"><CircleHelp size={16} /><p><strong>LP portfolio</strong> · This page shows your verified Base Sepolia liquidity positions. Modeled deposits and cover requests are excluded.</p></div>
    {!walletAccount ? <Card className="kd-card mw-panel"><div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>Connect your wallet</h2><p>Your nWETH/nUSDC positions will appear here after they are minted and verified.</p><Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={14} /></Button></div></Card> : <>
      <div className="mw-stats">
        <Card className="kd-card"><div className="mw-stat"><span>LIQUIDITY POSITIONS</span><strong>{positions.length}</strong><small>Verified Base Sepolia mints</small></div></Card>
        <Card className="kd-card"><div className="mw-stat"><span>SHORTFALL RECEIVED</span><strong>{paidShortfall === null ? "—" : formatUnits(paidShortfall, 6)}</strong><small>nUSDC · confirmed policy payouts</small></div></Card>
        <Card className="kd-card"><div className="mw-stat"><span>nWETH PROVIDED</span><strong>{walletAccount ? Number(formatUnits(nwethProvided, 18)).toFixed(5) : "—"}</strong><small>Faucet token · at mint</small></div></Card>
        <Card className="kd-card"><div className="mw-stat"><span>nUSDC PROVIDED</span><strong>{Number(formatUnits(usdcProvided, 6)).toFixed(2)}</strong><small>At mint</small></div></Card>
      </div>
      {error && <div className="mw-message is-error" role="alert">{error}</div>}
      <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2><PiggyBank size={16} /> Your LP positions</h2><span>{positions.length} ON-CHAIN</span></div>
        <div className="mw-position-list">{loading ? <div className="mw-portfolio-empty"><p>Loading your positions…</p></div> : positions.length ? positions.map((position) => {
          const requests = portfolioCoverage?.requests.filter((request) => request.tokenId === position.tokenId
            && request.lp.toLowerCase() === walletAccount.toLowerCase()) ?? [];
          const policy = requests.find((request) => request.status === 2);
          const pending = requests.find((request) => request.status === 1);
          const existing = policy ?? pending;
          const protectionLabel = policy ? (policy.endAt > coverageNow ? "Protected · View policy" : "Coverage ended · View policy")
            : "Coverage requested · View request";
          return <div className="mw-position" key={position.tokenId}>
          <TokenPairIcon pair={`${position.wethSymbol} / nUSDC`} size="small" />
          <div><strong>Uniswap position #{position.tokenId}</strong><small>{Number(formatUnits(BigInt(position.wethRaw), 18)).toFixed(5)} {position.wethSymbol} + {Number(formatUnits(BigInt(position.usdcRaw), 6)).toFixed(2)} nUSDC · {new Date(position.mintedAt).toLocaleDateString()}</small></div>
          {position.wethSymbol === "nWETH" && (portfolioCoverageError || !portfolioCoverage
            ? <Button variant="outline" size="sm" disabled>{portfolioCoverageError ? "Coverage unavailable" : "Checking coverage…"}</Button>
            : existing ? <Button asChild variant="outline" size="sm"><a href={`#coverage-policy-${existing.id}`}>{protectionLabel} <ShieldCheck size={13} /></a></Button>
            : <Button asChild variant="outline" size="sm"><Link href={`/dashboard/pools/${position.marketId}#protect-lp-fees`}>Protect fees <ShieldCheck size={13} /></Link></Button>)}
          <Button asChild variant="outline" size="sm"><a href={basescanTx(position.txHash)} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={13} /></a></Button>
        </div>; }) : <div className="mw-portfolio-empty"><PiggyBank size={24} /><h2>No on-chain positions yet</h2><p>Mint an nWETH/nUSDC position in the deployed pool to see it here.</p><Button asChild variant="outline"><Link href="/dashboard/pools">View pools <ArrowRight size={14} /></Link></Button></div>}</div>
      </Card>
      <CoverageBoard account={walletAccount} role="lp" portfolio />
    </>}
  </div>;
}

export function WorkspaceOverview({ role, walletAccount, onConnect }: {
  role: WorkspaceRole;
  walletAccount: string | null;
  onConnect: () => Promise<void>;
}) {
  const [positions, setPositions] = useState<ChainPosition[]>([]);
  const [error, setError] = useState("");

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

  const nwethProvided = positions.filter((position) => position.wethSymbol === "nWETH").reduce((sum, position) => sum + BigInt(position.wethRaw), BigInt(0));
  const usdcProvided = positions.reduce((sum, position) => sum + BigInt(position.usdcRaw), BigInt(0));

  return <div className="mw-role-overview">
    <div className="mw-role-intro"><div><span>{role === "lp" ? "LIQUIDITY PROVIDER" : "UNDERWRITER"} / OVERVIEW</span><h2>{role === "lp" ? "Your liquidity at a glance" : "Your underwriting desk"}</h2><p>{role === "lp" ? "See verified testnet positions and find a pool to provide liquidity." : "Study pool fee history and risk before deciding what protection to quote."}</p></div><Button asChild variant="outline"><Link href={role === "lp" ? "/dashboard/pools" : "/dashboard/backtest"}>{role === "lp" ? "Explore pools" : "Open backtest"} <ArrowRight size={15} /></Link></Button></div>
    {error && <div className="mw-message is-error" role="alert">{error}</div>}
    <div className="mw-stats mw-role-stats">{role === "lp" ? <>
      <Card className="kd-card"><div className="mw-stat"><span>LIQUIDITY POSITIONS</span><strong>{walletAccount ? positions.length : "—"}</strong><small>Verified Base Sepolia mints</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>nWETH PROVIDED</span><strong>{walletAccount ? Number(formatUnits(nwethProvided, 18)).toFixed(5) : "—"}</strong><small>Faucet token · at mint</small></div></Card>
      <Card className="kd-card"><div className="mw-stat"><span>nUSDC PROVIDED</span><strong>{walletAccount ? Number(formatUnits(usdcProvided, 6)).toFixed(2) : "—"}</strong><small>At mint</small></div></Card>
    </> : <CoverageStats account={walletAccount} />}</div>
    <Card className="kd-card mw-role-next"><div className="kd-card-heading"><h2>{role === "lp" ? <><PiggyBank size={16} /> Your next step</> : <><ShieldCheck size={16} /> Underwriting workflow</>}</h2><span>BASE SEPOLIA</span></div><div className="mw-role-next-inner"><h3>{role === "lp" ? walletAccount ? positions.length ? "Review your positions" : "Mint your first position" : "Connect to see your positions" : "Fund a coverage range"}</h3><p>{role === "lp" ? "Choose a deployed pool and price range, then mint an nWETH/nUSDC position with your wallet. Then request a fee target and duration, and buy matching funded coverage." : "Choose bins, fund a coverage offer, and set its duration and premium. Track reserved capital and premiums in your backing portfolio."}</p>{role === "lp" && !walletAccount ? <Button variant="outline" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={15} /></Button> : <Link href={role === "lp" ? positions.length ? "/dashboard/portfolio" : "/dashboard/pools" : "/dashboard/backtest"}>{role === "lp" ? positions.length ? "View portfolio" : "Browse pools" : "Study backtest"} <ArrowRight size={15} /></Link>}</div></Card>
  </div>;
}
