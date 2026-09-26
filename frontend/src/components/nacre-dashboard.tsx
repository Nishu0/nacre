"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  Activity, ArrowRight, ArrowUpRight, Bell, ChevronDown, CircleHelp,
  Compass, Database, ExternalLink, Layers3, LayoutGrid, LogOut, Menu,
  PiggyBank, Droplets, DollarSign, Plus,
  PanelLeftClose, PanelLeftOpen, RefreshCw, Search, ShieldCheck, Wallet, X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkspacePortfolio, type WorkspaceRole } from "@/components/market-workspace";
import { PoolCreateFlow } from "@/components/pool-create-flow";
import { BidWorkspace } from "@/components/bid-workspace";
import { WorkspaceBalances } from "@/components/workspace-balances";
import { TestUsdcFaucet } from "@/components/test-usdc-faucet";
import { TokenPairIcon } from "@/components/token-pair-icon";

import { UnderwritingSimulator } from "@/components/underwriting-simulator";
import type { YieldDay } from "@/lib/underwriting-simulator";

type Pool = { id: string; symbol: string; feeTier: string; chain: string; protocol: string; address: string; dataSource: string; yieldSource: string; capturedAt: string | null };
type FeeWindow = { start: string; end: string; feesUsd: number };
type DailyEvidence = { date: string; volumeUsd: number; grossPoolFeesUsd: number; modeledPositionFeesUsd: number; tvlUsd: number };
type Backtest = { yieldHistory: YieldDay[]; pool: Pool; principalUsd: number; sampleDays: number; displayedDays: number; windowCount: number; recent: FeeWindow; best: FeeWindow; worst: FeeWindow; windows: FeeWindow[]; daily: DailyEvidence[]; volume90dUsd: number; grossPoolFees90dUsd: number; modeledPositionFees90dUsd: number; medianDailyVolumeUsd: number };
type QuoteTier = { id: string; label: string; feeFloorUsd: number; payoutCapUsd: number; indicativePremiumUsd: number; minimumNetFeesAfterPremiumUsd: number; payoutWindowCount: number };
type QuoteResearch = Backtest & { quotes: QuoteTier[]; pricingMethod: string };
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: "accountsChanged", listener: (accounts: string[]) => void) => void;
  removeListener?: (event: "accountsChanged", listener: (accounts: string[]) => void) => void;
};
declare global { interface Window { ethereum?: EthereumProvider } }

export type DashboardView = "overview" | "pools" | "pool-create" | "pool-detail" | "portfolio" | "faucet" | "backtest" | "references" | "launch" | "pricing";
const navigation = [
  { href: "/dashboard", view: "overview", label: "Overview", icon: LayoutGrid, group: "workspace" },
  { href: "/dashboard/pools", view: "pools", label: "Coverage bids", icon: Droplets, group: "workspace" },
  { href: "/dashboard/portfolio", view: "portfolio", label: "Portfolio", icon: PiggyBank, group: "workspace" },
  { href: "/dashboard/faucet", view: "faucet", label: "Test token faucet", icon: DollarSign, group: "workspace" },
  { href: "/dashboard/backtest", view: "backtest", label: "Fee backtest", icon: Activity, group: "research" },
  { href: "/dashboard/references", view: "references", label: "Reference data", icon: Database, group: "research" },
  { href: "/dashboard/launch", view: "launch", label: "Launch steps", icon: Layers3, group: "research" },
  { href: "/dashboard/pricing", view: "pricing", label: "Premium model", icon: ShieldCheck, group: "research" },
] as const;
const roleNavLabel = (view: DashboardView, role: WorkspaceRole) => {
  if (view === "overview") return role === "lp" ? "LP overview" : "Underwriter overview";
  if (view === "portfolio") return role === "lp" ? "LP portfolio" : "Backing portfolio";
  return navigation.find((item) => item.view === view)?.label ?? "Pool details";
};
const pageCopy: Record<DashboardView, { title: string; description: string }> = {
  overview: { title: "Build a fee floor market", description: "Explore historical fee yield, then follow the steps to launch a funded v4 protection pool." },
  pools: { title: "Coverage bids", description: "Underwriters fund ranges. Investors choose from available funded bids." },
  "pool-detail": { title: "Coverage bids", description: "Choose a funded range to get started." },
  "pool-create": { title: "Create pool", description: "Choose the token pair, starting price and pool configuration." },
  portfolio: { title: "Portfolio", description: "Review verified Base Sepolia liquidity positions." },
  faucet: { title: "Test token faucet", description: "Claim nUSDC and nWETH for your Base Sepolia positions." },
  backtest: { title: "Fee backtest", description: "Compare historical Uniswap fee windows at your chosen capital size." },
  references: { title: "Reference data", description: "Six months of high-volume Uniswap v3 pool history for future v4 market research." },
  launch: { title: "Launch steps", description: "A new market opens when its liquidity and protection are both funded." },
  pricing: { title: "Premium model", description: "Explore indicative fee floors, payout caps, and premiums before an underwriter makes a real quote." },
};
const launchSteps = [
  { number: "01", title: "Create a v4 pool", detail: "Deploy a new Uniswap v4 pool with the Nacre fee hook. The v3 series on this page are pricing references." },
  { number: "02", title: "Fund an LP position", detail: "Mint a Uniswap position receipt, choose a 30-day fee floor and cap, then escrow that receipt with the request." },
  { number: "03", title: "Invite underwriters", detail: "Makers publish competing Aqua quotes for the same request and approve enough USDC for the cap." },
  { number: "04", title: "Activate together", detail: "The LP accepts one quote. Aqua pulls the full cap into the vault as the premium moves to the maker." },
];
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const compactMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(value);
const exactMoney = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const shortAddress = (account: string) => `${account.slice(0, 6)}…${account.slice(-4)}`;

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Could not load research data");
  return data;
}

function NacreMark() {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M5 32.5C7.8 17.2 15.5 9.5 24 7c8.5 2.5 16.2 10.2 19 25.5-5 6.2-11.5 9.3-19 9.3S10 38.7 5 32.5Z" stroke="currentColor" strokeWidth="1.5" /><path d="M24 8v31M13 16l8 22M35 16l-8 22M7.5 26l11.7 12M40.5 26 28.8 38" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /><path d="M10 32c9 3.3 19 3.3 28 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" /></svg>;
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), span = Math.max(...values) - min || 1;
  const points = values.map((value, index) => `${index * (104 / (values.length - 1))},${35 - ((value - min) / span) * 26}`).join(" ");
  return <svg className="kd-sparkline" viewBox="0 0 104 40" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MetricCard({ title, value, context, icon: Icon, values }: { title: string; value: string; context: string; icon: typeof Activity; values: number[] }) {
  return <Card className="kd-card kd-metric"><div className="kd-card-heading"><h2>{title}</h2><Icon size={16} aria-hidden="true" /></div><div className="kd-metric-inner"><strong>{value}</strong><Sparkline values={values} /><p>{context}</p></div></Card>;
}

function FeeChart({ daily }: { daily: DailyEvidence[] }) {
  const shown = daily.slice(-90);
  const [active, setActive] = useState(shown.length - 1);
  const selected = Math.min(Math.max(active, 0), shown.length - 1);
  const ceiling = Math.max(...shown.map((row) => row.modeledPositionFeesUsd), 1) * 1.18;
  return <div className="kd-chart kd-research-chart" role="group" aria-label="Daily modeled position fees over the latest 90 days"><div className="kd-plot">
    {[0, .25, .5, .75, 1].map((fraction) => <div key={fraction} className="kd-chart-gridline" style={{ bottom: `${fraction * 100}%` }}><span>{money(ceiling * fraction)}</span></div>)}
    <div className="kd-chart-bars">{shown.map((day, index) => <button key={day.date} type="button" className={`kd-bar${selected === index ? " is-active" : ""}`} style={{ height: `${Math.max(2, day.modeledPositionFeesUsd / ceiling * 100)}%` }} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} aria-label={`${shortDate(day.date)}: ${exactMoney(day.modeledPositionFeesUsd)} modeled position fees, ${money(day.volumeUsd)} pool volume`} />)}</div>
    {shown[selected] && <div className="kd-chart-tooltip" style={{ left: `${((selected + .5) / shown.length) * 100}%`, bottom: `calc(${shown[selected].modeledPositionFeesUsd / ceiling * 100}% + 11px)` }}>{shortDate(shown[selected].date)} · {exactMoney(shown[selected].modeledPositionFeesUsd)}</div>}
  </div><div className="kd-chart-labels">{shown.map((day, index) => <span key={day.date}>{index % 15 === 0 || index === shown.length - 1 ? shortDate(day.date) : ""}</span>)}</div></div>;
}

function LaunchPath({ expanded = false }: { expanded?: boolean }) {
  return <Card className={`kd-card kd-launch-panel${expanded ? " kd-launch-expanded" : ""}`}><div className="kd-card-heading"><h2><Layers3 size={17} /> Launch path</h2><span>4 STEPS</span></div><div className="kd-launch-inner"><div className="kd-launch-heading"><Badge variant="outline">TESTNET POOL DEPLOYED</Badge><p>The WETH/nUSDC pool is initialized on Base Sepolia. Liquidity positions and protection must still be funded on-chain.</p></div><ol>{launchSteps.map((step) => <li key={step.number}><span>{step.number}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}</ol><Link href="/dashboard/references" className="kd-text-link">Compare reference pairs <ArrowRight size={15} /></Link></div></Card>;
}

export function NacreDashboard({ view = "overview", initialPoolId = "usdc-weth-005", marketId }: { view?: DashboardView; initialPoolId?: string; marketId?: string }) {
  useEffect(() => {
    try {
      if (!localStorage.getItem("nacre-bid-workspace-v1")) {
        localStorage.removeItem("nacre-pool-create-draft-v1");
        localStorage.removeItem("nacre-sandbox-participant");
        localStorage.setItem("nacre-bid-workspace-v1", "1");
      }
    } catch { /* Storage is optional; balances always come from the chain. */ }
  }, []);
  const [pools, setPools] = useState<Pool[]>([]);
  const [backtests, setBacktests] = useState<Record<string, Backtest>>({});
  const [quoteState, setQuoteState] = useState<{ key: string; data: QuoteResearch } | null>(null);
  const [selectedPoolId, setSelectedPoolId] = useState(initialPoolId);
  const [principalInput, setPrincipalInput] = useState("100000");
  const [principalUsd, setPrincipalUsd] = useState(100000);
  const [loadedPrincipalUsd, setLoadedPrincipalUsd] = useState<number | null>(null);
  const [loading, setLoading] = useState(["overview", "backtest", "references", "pricing"].includes(view));
  const [error, setError] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [navSearch, setNavSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [role, setRole] = useState<WorkspaceRole>("lp");

  useEffect(() => {
    if (localStorage.getItem("nacre-workspace-role") === "underwriter") queueMicrotask(() => setRole("underwriter"));
  }, []);
  function changeRole(next: WorkspaceRole) {
    localStorage.setItem("nacre-workspace-role", next);
    setRole(next);
  }

  useEffect(() => {
    if (!["backtest", "references", "pricing"].includes(view)) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const list = await getJson<Pool[]>("/api/research/pools", controller.signal);
        const results = await Promise.all(list.map((pool) => getJson<Backtest>(`/api/research/pools/${pool.id}/backtest?principalUsd=${principalUsd}`, controller.signal)));
        if (controller.signal.aborted) return;
        setPools(list);
        setBacktests(Object.fromEntries(results.map((result) => [result.pool.id, result])));
        setLoadedPrincipalUsd(principalUsd);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the research API"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [principalUsd, refreshIndex, view, role]);

  useEffect(() => {
    if (!(view === "pricing") || !backtests[selectedPoolId]) return;
    const controller = new AbortController();
    const key = `${selectedPoolId}:${principalUsd}`;
    getJson<QuoteResearch>(`/api/research/pools/${selectedPoolId}/quotes?principalUsd=${principalUsd}`, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setQuoteState({ key, data }); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load pricing model"); });
    return () => controller.abort();
  }, [selectedPoolId, principalUsd, backtests, view, role]);

  useEffect(() => {
    let live = true;
    const provider = window.ethereum;
    const changed = (accounts: string[]) => {
      if (!live || sessionStorage.getItem("nacre-wallet-manually-disconnected") === "1") return;
      setWalletAccount(accounts[0] ?? null);
      if (accounts[0]) setWalletDialogOpen(false);
    };
    async function checkWallet() {
      try {
        if (sessionStorage.getItem("nacre-wallet-manually-disconnected") === "1") return;
        const accounts = provider ? await provider.request({ method: "eth_accounts" }) as string[] : [];
        if (!live) return;
        setWalletAccount(accounts[0] ?? null);
        if (!accounts[0] && sessionStorage.getItem("nacre-wallet-prompt-dismissed") !== "1") setWalletDialogOpen(true);
      } catch { if (live && sessionStorage.getItem("nacre-wallet-prompt-dismissed") !== "1") setWalletDialogOpen(true); }
    }
    void checkWallet(); provider?.on?.("accountsChanged", changed);
    return () => { live = false; provider?.removeListener?.("accountsChanged", changed); };
  }, []);

  const current = loadedPrincipalUsd === principalUsd ? backtests[selectedPoolId] : undefined;
  const quoteResearch = quoteState?.key === `${selectedPoolId}:${principalUsd}` ? quoteState.data : null;
  const selectedPool = pools.find((pool) => pool.id === selectedPoolId);
  const recentValues = current?.windows.slice(-12).map((row) => row.feesUsd) ?? [];
  const researchView = ["backtest", "references", "pricing"].includes(view);
  const visibleNav = useMemo(() => navigation.filter((item) => roleNavLabel(item.view, role).toLowerCase().includes(navSearch.toLowerCase())), [navSearch, role]);
  function applyPrincipal() {
    const value = Number(principalInput);
    if (!Number.isFinite(value) || value < 100 || value > 10_000_000) { setError("Enter capital between $100 and $10,000,000."); return; }
    setError(""); setPrincipalUsd(value);
  }
  function dismissWalletPrompt() { sessionStorage.setItem("nacre-wallet-prompt-dismissed", "1"); setWalletDialogOpen(false); setWalletError(""); }
  async function connectWallet() {
    if (!window.ethereum) { setWalletError("No browser wallet was found. You can still explore the research data."); return; }
    setConnecting(true); setWalletError("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts[0]) { sessionStorage.removeItem("nacre-wallet-manually-disconnected"); setWalletAccount(accounts[0]); setWalletDialogOpen(false); }
    } catch { setWalletError("The connection was not completed. You can continue without a wallet."); }
    finally { setConnecting(false); }
  }
  async function disconnectWallet() {
    sessionStorage.setItem("nacre-wallet-manually-disconnected", "1"); setWalletAccount(null); setWalletError("");
    try { await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); }
    catch { /* Wallets without revocation can still disconnect for this session. */ }
  }

  return <div className={`dashboard${sidebarCollapsed ? " is-collapsed" : ""}`}>
    {mobileNavOpen && <button className="kd-sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`kd-sidebar${mobileNavOpen ? " is-open" : ""}`} aria-label="Dashboard navigation">
      <div className="kd-sidebar-brand-row"><Link href="/" className="kd-brand" aria-label="Nacre home"><span className="kd-brand-icon"><NacreMark /></span><span>Nacre</span></Link><button className="kd-collapse-button" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="kd-mobile-close" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
      <div className="kd-role-switch" role="group" aria-label="Dashboard role"><button type="button" className={role === "lp" ? "is-active" : ""} aria-pressed={role === "lp"} onClick={() => changeRole("lp")} title="Liquidity provider view"><PiggyBank size={15} /><span>LP</span></button><button type="button" className={role === "underwriter" ? "is-active" : ""} aria-pressed={role === "underwriter"} onClick={() => changeRole("underwriter")} title="Underwriter view"><ShieldCheck size={15} /><span>Underwriter</span></button></div>
      <label className="kd-sidebar-search"><Search size={17} aria-hidden="true" /><Input type="search" aria-label="Search navigation" placeholder="Search navigation" value={navSearch} onChange={(event) => setNavSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
      <nav className="kd-sidebar-nav">
        {(["workspace", "research"] as const).map((group) => <div className="kd-nav-group" key={group}><p>{group.toUpperCase()}</p>{visibleNav.filter((item) => item.group === group).map((item) => { const Icon = item.icon; const active = view === item.view || ((view === "pool-detail" || view === "pool-create") && item.view === "pools"); return <Link key={item.href} href={item.href} className={`kd-nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setMobileNavOpen(false)} title={sidebarCollapsed ? roleNavLabel(item.view, role) : undefined}><Icon size={17} /><span>{roleNavLabel(item.view, role)}</span></Link>; })}</div>)}
        <div className="kd-nav-group kd-support-nav"><p>SUPPORT</p><Link href="/#model" className="kd-nav-link"><CircleHelp size={17} /><span>How Nacre works</span></Link><Link href="/" className="kd-nav-link"><ArrowUpRight size={17} /><span>Back to website</span></Link></div>
      </nav>
      {walletAccount ? <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="kd-account-card" type="button" aria-label="Wallet menu"><span className="kd-account-avatar"><NacreMark /></span><span><strong>{shortAddress(walletAccount)}</strong><small>Wallet connected</small></span><ChevronDown size={16} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="kd-account-menu" side="top" align="start" sideOffset={8}><p>CONNECTED WALLET</p><span className="kd-menu-address">{shortAddress(walletAccount)}</span><DropdownMenu.Separator /><DropdownMenu.Item className="kd-disconnect-item" onSelect={() => void disconnectWallet()}><LogOut size={15} /> Disconnect wallet</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root> : <button className="kd-account-card" type="button" onClick={() => setWalletDialogOpen(true)}><span className="kd-account-avatar">N</span><span><strong>Research workspace</strong><small>Wallet optional</small></span><ChevronDown size={16} /></button>}
    </aside>

    <main className="kd-main"><header className="kd-topbar"><div className="kd-breadcrumb"><button className="kd-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><LayoutGrid size={17} /><span>{["overview", "pools", "pool-create", "pool-detail", "portfolio", "faucet"].includes(view) ? "Workspace" : "Research"}</span><span className="kd-breadcrumb-slash">/</span><strong>{view === "pool-detail" ? "Pools / Detail" : view === "pool-create" ? "Pools / Create" : roleNavLabel(view, role)}</strong></div><div className="kd-topbar-actions"><Badge variant="outline" className="kd-research-badge">{researchView ? "HISTORICAL DATA" : "NACRE WORKSPACE"}</Badge><DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="kd-notification-button" aria-label="Notifications"><Bell size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="kd-account-menu kd-notification-menu" side="bottom" align="end" sideOffset={8}><p>NOTIFICATIONS</p><span>No pool or policy updates yet.</span></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div></header>
      <div className="kd-content"><div className="kd-page-intro"><div><h1>{view === "overview" ? role === "lp" ? "LP overview" : "Underwriter overview" : pageCopy[view].title} <span aria-hidden="true">✳</span></h1><p>{view === "overview" ? "Your wallet balances on Base Sepolia." : view === "portfolio" && role === "underwriter" ? "Review active on-chain coverage policies." : pageCopy[view].description}</p></div><div className="flex flex-wrap items-center gap-3"><Badge variant="outline" className="kd-no-live-badge">{["overview", "pools", "pool-create", "pool-detail", "portfolio", "faucet"].includes(view) ? "BASE SEPOLIA · DEMO" : "HISTORICAL RESEARCH"}</Badge>{view === "overview" && role === "underwriter" && <Button asChild className="kd-apply-button"><Link href="/dashboard/pools/create"><Plus size={16} /> Create pool</Link></Button>}</div></div>
        {view === "overview" && <WorkspaceBalances account={walletAccount} onConnect={connectWallet} />}
        {view === "pool-create" && <PoolCreateFlow account={walletAccount} onConnect={connectWallet} />}
        {["pools", "pool-detail"].includes(view) && <BidWorkspace marketId={marketId} key={`${role}:${walletAccount}`} role={role} onRoleChange={changeRole} walletAccount={walletAccount} onConnect={connectWallet} />}
        {view === "portfolio" && <WorkspacePortfolio role={role} walletAccount={walletAccount} onConnect={connectWallet} />}
        {view === "faucet" && <TestUsdcFaucet account={walletAccount} onConnect={connectWallet} />}
        {view === "launch" && <div className="kd-launch-page"><LaunchPath expanded /><Card className="kd-card kd-launch-aside"><div className="kd-card-heading"><h2><ShieldCheck size={17} /> Funding gate</h2><span>MARKET STATUS</span></div><div className="kd-launch-aside-inner"><span className="kd-launch-status">NOT FUNDED</span><h2>Both sides commit before a market opens.</h2><p>LP capital establishes the pool. Underwriter collateral backs the selected fee floor. Once both are committed, coverage can begin.</p><Link href="/dashboard/pools" className="kd-text-link">View pool directory <ArrowRight size={15} /></Link></div></Card></div>}
        {researchView && <><Card className="kd-card kd-controls-card" id="backtest"><div className="kd-card-heading"><h2><Compass size={16} /> {view === "references" ? "Reference inputs" : view === "pricing" ? "Model inputs" : "Backtest inputs"}</h2><span>UNISWAP V3 REFERENCE</span></div><div className="kd-controls-inner"><label className="kd-field"><span>Historical pair</span><span className="kd-select-wrap"><select value={selectedPoolId} onChange={(event) => setSelectedPoolId(event.target.value)} aria-label="Historical reference pair">{pools.length ? pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.symbol} · {pool.feeTier}</option>) : <option value={selectedPoolId}>Loading references…</option>}</select><ChevronDown size={15} /></span></label><label className="kd-field"><span>Modeled capital (USD)</span><Input type="number" min="100" max="10000000" step="100" value={principalInput} onChange={(event) => setPrincipalInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") applyPrincipal(); }} /></label><Button type="button" className="kd-apply-button" onClick={applyPrincipal}>{view === "references" ? "Update figures" : view === "pricing" ? "Update model" : "Run backtest"} <ArrowRight size={15} /></Button><Button type="button" variant="outline" size="icon" className="kd-refresh-button" aria-label="Refresh research data" onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={15} /></Button></div></Card>
        {error && <div className="kd-error-state" role="alert"><CircleHelp size={17} /><span>{error}</span><Button size="sm" variant="outline" onClick={() => setRefreshIndex((value) => value + 1)}>Retry</Button></div>}
        {loading && <div className="kd-loading-state" role="status">Loading historical fee data…</div>}
        {current && <>{view === "backtest" && <UnderwritingSimulator key={selectedPoolId} history={current.yieldHistory ?? []} reference={`${current.pool.symbol} · ${current.pool.feeTier}`} />}{(view === "overview" || view === "backtest") && <><div className="kd-metrics-grid kd-research-metrics"><MetricCard title="Recent 30 days" value={money(current.recent.feesUsd)} context={`${shortDate(current.recent.start)}–${shortDate(current.recent.end)} · modeled fees`} icon={Activity} values={recentValues} /><MetricCard title="Best 30 days" value={money(current.best.feesUsd)} context={`${shortDate(current.best.start)}–${shortDate(current.best.end)} · historical high`} icon={ArrowUpRight} values={recentValues} /><MetricCard title="90-day volume" value={compactMoney(current.volume90dUsd)} context={`${current.displayedDays} daily pool observations`} icon={Activity} values={recentValues} /><MetricCard title="90-day gross pool fees" value={compactMoney(current.grossPoolFees90dUsd)} context="Volume × fee tier · before protocol share" icon={Database} values={recentValues} /></div>
          <div className="kd-overview-grid kd-research-grid"><Card className="kd-card kd-trend-panel" id="analytics"><div className="kd-card-heading"><h2><Activity size={17} /> Daily modeled fees</h2><span>{selectedPool?.symbol} · {selectedPool?.feeTier}</span></div><div className="kd-trend-inner"><div className="kd-trend-summary"><strong>{money(current.recent.feesUsd)}</strong><small>latest modeled 30-day fees on {money(principalUsd)} capital</small></div><FeeChart key={selectedPoolId + principalUsd} daily={current.daily} /><p className="kd-chart-caption">{current.displayedDays} daily observations shown from {current.sampleDays} historical days · pool-level base APY, not earnings of a specific range.</p></div></Card>
            {view === "overview" && role === "lp" && <LaunchPath />}</div></>}
          {(view === "overview" || view === "references") && <section className="kd-data-section" id="reference-pools"><Card className="kd-card kd-table-panel"><div className="kd-card-heading"><h2><Database size={17} /> Historical reference pools</h2><span>3 HIGH-VOLUME POOLS · 180 DAYS</span></div><div className="kd-table-inner"><div className="kd-table-scroll"><table><thead><tr><th>REFERENCE PAIR</th><th>RECENT 30D</th><th>BEST 30D</th><th>WORST 30D</th><th>90D VOLUME</th><th>90D POOL FEES</th><th>DATA</th><th>SELECT</th></tr></thead><tbody>{pools.map((pool) => { const result = backtests[pool.id]; return <tr key={pool.id}><td><div className="kd-pair-cell"><TokenPairIcon pair={pool.symbol} size="small" /><span><strong>{pool.symbol}</strong><small>{pool.protocol} · {pool.feeTier}</small></span></div></td><td>{result ? exactMoney(result.recent.feesUsd) : "—"}</td><td>{result ? exactMoney(result.best.feesUsd) : "—"}</td><td>{result ? exactMoney(result.worst.feesUsd) : "—"}</td><td>{result ? compactMoney(result.volume90dUsd) : "—"}</td><td>{result ? compactMoney(result.grossPoolFees90dUsd) : "—"}</td><td><a href={pool.dataSource} target="_blank" rel="noreferrer" className="kd-source-link" aria-label={`Volume source for ${pool.symbol}`}><ExternalLink size={14} /> Volume</a> <a href={pool.yieldSource} target="_blank" rel="noreferrer" className="kd-source-link" aria-label={`Yield source for ${pool.symbol}`}><ExternalLink size={14} /> Yield</a></td><td><Button asChild variant="ghost" size="sm"><Link href={`/dashboard/backtest?pool=${pool.id}`}>Backtest <ArrowRight size={14} /></Link></Button></td></tr>; })}</tbody></table></div></div></Card><p className="kd-data-note"><CircleHelp size={14} /> Volume comes from GeckoTerminal pool OHLCV; pool-level APY and TVL come from DefiLlama. Gross pool fees are volume × fee tier. Neither figure is realized fees for a particular concentrated LP range or an active Nacre policy.</p></section>}
          {(view === "overview" || view === "pricing") && <section className="kd-market-section" id="pricing"><div className="kd-market-intro"><div><h2>Indicative premium model</h2><p>Explore how a higher fee floor changes modeled shortfall and premium.</p></div><span>UNDERWRITER QUOTES <strong>0</strong></span></div>{quoteResearch ? <Tabs defaultValue="current" className="kd-pricing-tabs"><TabsList className="kd-pricing-tab-list">{quoteResearch.quotes.map((tier) => <TabsTrigger key={tier.id} value={tier.id}>{tier.id === "current" ? "Current run rate" : "Stretch floor"}</TabsTrigger>)}</TabsList>{quoteResearch.quotes.map((tier) => <TabsContent value={tier.id} key={tier.id}><Card className="kd-card kd-pricing-card"><div className="kd-card-heading"><h3><ShieldCheck size={16} /> {tier.label}</h3><Badge variant="outline">MODELED · NOT EXECUTABLE</Badge></div><div className="kd-pricing-inner"><div><small>30-DAY FEE FLOOR</small><strong>{exactMoney(tier.feeFloorUsd)}</strong><span>The amount this scenario aims to protect.</span></div><div><small>INDICATIVE PREMIUM</small><strong>{exactMoney(tier.indicativePremiumUsd)}</strong><span>Research estimate. A maker must set a real price.</span></div><div><small>FULLY BACKED CAP</small><strong>{exactMoney(tier.payoutCapUsd)}</strong><span>Collateral needed to cover zero eligible fees.</span></div><div><small>NET FLOOR AFTER PREMIUM</small><strong>{exactMoney(tier.minimumNetFeesAfterPremiumUsd)}</strong><span>Before gas and token price changes.</span></div></div><p className="kd-pricing-footnote">{tier.payoutWindowCount} of {quoteResearch.windowCount} historical windows fell below this floor. {quoteResearch.pricingMethod}</p></Card></TabsContent>)}</Tabs> : <Card className="kd-card kd-pricing-card"><div className="kd-pricing-empty">{loading ? "Calculating scenarios…" : "Choose a reference pair to see modeled premium tiers."}</div></Card>}{current && <Card className="kd-card kd-underwriter-evidence"><div className="kd-card-heading"><h3><Database size={16} /> Underwriter market evidence</h3><span>LAST 90 OF {current.sampleDays} DAYS</span></div><div className="kd-underwriter-evidence-grid"><div><small>POOL VOLUME</small><strong>{compactMoney(current.volume90dUsd)}</strong></div><div><small>GROSS POOL FEES</small><strong>{compactMoney(current.grossPoolFees90dUsd)}</strong></div><div><small>MEDIAN DAILY VOLUME</small><strong>{compactMoney(current.medianDailyVolumeUsd)}</strong></div><div><small>MODELED FEES ON {money(principalUsd)}</small><strong>{money(current.modeledPositionFees90dUsd)}</strong></div></div><p>Gross fees use daily volume × the pool fee tier. Position fees use DefiLlama base APY as a broad pool-level proxy; they cannot price a specific tick range on their own. <a href={selectedPool?.dataSource} target="_blank" rel="noreferrer">Volume source ↗</a> <a href={selectedPool?.yieldSource} target="_blank" rel="noreferrer">Yield source ↗</a></p></Card>}<p className="kd-demo-note"><CircleHelp size={14} /> Pool-level estimates are research inputs, not executable Aqua quotes or an offer of coverage.</p></section>}
        </>}
        {!current && !loading && !error && <Card className="kd-card kd-empty-data"><div>No research data is available yet. Start the Bun server and refresh this page.</div></Card>}
        </>}
      </div></main>
    <Dialog.Root open={walletDialogOpen} onOpenChange={(open) => { if (!open) dismissWalletPrompt(); else setWalletDialogOpen(true); }}><Dialog.Portal><Dialog.Overlay className="kd-wallet-overlay" /><Dialog.Content className="kd-wallet-dialog"><button className="kd-wallet-close" type="button" aria-label="Close wallet prompt" onClick={dismissWalletPrompt}><X size={18} /></button><span className="kd-dialog-logo"><NacreMark /></span><Dialog.Title>Explore Nacre with a wallet</Dialog.Title><Dialog.Description>Connect when you are ready, or explore historical fee data and the launch steps without a wallet.</Dialog.Description>{walletError && <p className="kd-wallet-error" role="alert">{walletError}</p>}<Button className="kd-dialog-connect" onClick={connectWallet} disabled={connecting}><Wallet size={16} /> {connecting ? "Connecting…" : "Connect wallet"}</Button><button className="kd-dialog-skip" type="button" onClick={dismissWalletPrompt}>Continue to research <ArrowRight size={16} /></button><p className="kd-dialog-note">No signature is needed to view the dashboard.</p></Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
