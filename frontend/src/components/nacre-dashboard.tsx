"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DropdownMenu } from "radix-ui";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  CircleHelp,
  Compass,
  LayoutGrid,
  Layers3,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Period = "7D" | "30D" | "90D";
type ActivityRange = "Today" | "Yesterday" | "This week";
type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: "accountsChanged", listener: (accounts: string[]) => void) => void;
  removeListener?: (event: "accountsChanged", listener: (accounts: string[]) => void) => void;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const chartSeries: Record<Period, { bars: number[]; labels: string[]; floor: number; total: string; change: string }> = {
  "7D": { bars: [310, 510, 590, 385, 470, 584, 435, 505, 610, 565, 540, 585, 360, 620], labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], floor: 500, total: "$2,482", change: "+12.8%" },
  "30D": { bars: [390, 480, 565, 430, 605, 545, 685, 610, 560, 690, 625, 725], labels: ["W1", "W2", "W3", "W4", "W5", "W6"], floor: 535, total: "$9,614", change: "+8.4%" },
  "90D": { bars: [365, 420, 495, 570, 530, 615, 665, 630, 735], labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep"], floor: 520, total: "$28,406", change: "+18.2%" },
};

const positions = [
  { pair: "ETH / USDC", pool: "Uniswap v4 · 0.05%", range: "$2,420 – $3,180", fees: "$1,284.20", floor: "$1,500", status: "Protected", mark: "ETH" },
  { pair: "WBTC / ETH", pool: "Uniswap v4 · 0.30%", range: "23.8 – 29.6 ETH", fees: "$742.80", floor: "$1,000", status: "Near edge", mark: "BTC" },
  { pair: "USDC / DAI", pool: "Uniswap v4 · 0.01%", range: "$0.998 – $1.002", fees: "$455.40", floor: "$600", status: "Protected", mark: "USD" },
];

const updates = [
  { day: "Today", title: "New quote received", detail: "ETH / USDC · 2.4% premium", time: "11:42 AM", icon: Sparkles, tone: "green" },
  { day: "Today", title: "Fee floor holding", detail: "USDC / DAI · 7 day window", time: "09:18 AM", icon: ShieldCheck, tone: "green" },
  { day: "Today", title: "Fees checkpoint", detail: "ETH / USDC · $1,284 eligible", time: "08:50 AM", icon: Activity, tone: "blue" },
  { day: "Yesterday", title: "Position near range edge", detail: "WBTC / ETH · review cover", time: "04:32 PM", icon: ArrowDownRight, tone: "amber" },
  { day: "Yesterday", title: "Quote window updated", detail: "ETH / USDC · 3 offers", time: "01:10 PM", icon: Compass, tone: "blue" },
  { day: "Yesterday", title: "Protection renewed", detail: "USDC / DAI · new 7 day window", time: "10:24 AM", icon: ShieldCheck, tone: "green" },
] as const;

const quotes = [
  { name: "Verdant", initials: "VE", premium: "2.4%", capacity: "$4,000", note: "Best price" },
  { name: "Cove", initials: "CO", premium: "2.7%", capacity: "$7,500", note: "Most capacity" },
  { name: "Delta House", initials: "DH", premium: "3.1%", capacity: "$12,000", note: "Flexible size" },
];

const mainNavigation = [
  { href: "#overview", label: "Overview", icon: LayoutGrid },
  { href: "#positions", label: "Positions", icon: Layers3 },
  { href: "#market", label: "Cover market", icon: Compass },
  { href: "#activity", label: "Activity", icon: Activity },
];

const insightNavigation = [
  { href: "#analytics", label: "Fee performance", icon: Activity },
  { href: "#market", label: "Underwriter quotes", icon: ShieldCheck },
];

function NacreMark({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path d="M5 32.5C7.8 17.2 15.5 9.5 24 7c8.5 2.5 16.2 10.2 19 25.5-5 6.2-11.5 9.3-19 9.3S10 38.7 5 32.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 8v31M13 16l8 22M35 16l-8 22M7.5 26l11.7 12M40.5 26 28.8 38" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      <path d="M10 32c9 3.3 19 3.3 28 0" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function Sparkline({ values, muted = false }: { values: number[]; muted?: boolean }) {
  const min = Math.min(...values) - 6;
  const max = Math.max(...values) + 6;
  const points = values.map((value, index) => `${index * (104 / (values.length - 1))},${36 - ((value - min) / (max - min)) * 28}`).join(" ");
  return <svg className={`kd-sparkline${muted ? " is-muted" : ""}`} viewBox="0 0 104 40" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MetricCard({ title, value, change, context, icon: Icon, values, muted = false }: { title: string; value: string; change: string; context: string; icon: typeof Activity; values: number[]; muted?: boolean }) {
  return (
    <Card className="kd-card kd-metric" aria-label={title}>
      <div className="kd-card-heading"><h2>{title}</h2><Icon size={16} aria-hidden="true" /></div>
      <div className="kd-metric-inner"><strong>{value}</strong><Sparkline values={values} muted={muted} /><p><span className={muted ? "is-muted" : ""}>{change}</span> {context}</p></div>
    </Card>
  );
}

function FeeBars({ period }: { period: Period }) {
  const data = chartSeries[period];
  const [activeIndex, setActiveIndex] = useState(5);
  const selected = Math.min(activeIndex, data.bars.length - 1);
  const groupSize = data.bars.length / data.labels.length;

  return (
    <div className="kd-chart" role="group" aria-label="Illustrative fee income by period">
      <div className="kd-plot">
        {[0, 200, 400, 600, 800].map((tick) => <div key={tick} className="kd-chart-gridline" style={{ bottom: `${tick / 8}%` }}><span>{tick}</span></div>)}
        <div className="kd-floor-reference" style={{ bottom: `${data.floor / 8}%` }} />
        <div className="kd-chart-bars">
          {data.bars.map((value, index) => <button key={`${period}-${index}`} type="button" className={`kd-bar${selected === index ? " is-active" : ""}`} style={{ height: `${value / 8}%` }} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} aria-label={`${data.labels[Math.floor(index / groupSize)]}: ${value} relative fee units`} />)}
        </div>
        <div className="kd-chart-tooltip" style={{ left: `${((selected + .5) / data.bars.length) * 100}%`, bottom: `calc(${data.bars[selected] / 8}% + 10px)` }}>{data.labels[Math.floor(selected / groupSize)]}: {data.bars[selected]}</div>
      </div>
      <div className="kd-chart-labels">{data.labels.map((label) => <span key={label}>{label}</span>)}</div>
    </div>
  );
}

function shortAddress(account: string) {
  return `${account.slice(0, 6)}…${account.slice(-4)}`;
}

export function NacreDashboard() {
  const [period, setPeriod] = useState<Period>("7D");
  const [activityRange, setActivityRange] = useState<ActivityRange>("Today");
  const [activitySearch, setActivitySearch] = useState("");
  const [positionSearch, setPositionSearch] = useState("");
  const [navSearch, setNavSearch] = useState("");
  const [selectedQuote, setSelectedQuote] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("#overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [walletAccount, setWalletAccount] = useState<string | null>(null);
  const [walletError, setWalletError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let live = true;
    const provider = window.ethereum;
    const onAccountsChanged = (accounts: string[]) => {
      if (!live) return;
      if (sessionStorage.getItem("nacre-wallet-manually-disconnected") === "1") return;
      setWalletAccount(accounts[0] ?? null);
      if (accounts[0]) setWalletDialogOpen(false);
    };
    async function checkWallet() {
      try {
        if (sessionStorage.getItem("nacre-wallet-manually-disconnected") === "1") return;
        const accounts = provider ? (await provider.request({ method: "eth_accounts" }) as string[]) : [];
        if (!live) return;
        setWalletAccount(accounts[0] ?? null);
        if (!accounts[0] && sessionStorage.getItem("nacre-wallet-prompt-dismissed") !== "1") setWalletDialogOpen(true);
      } catch {
        if (live && sessionStorage.getItem("nacre-wallet-prompt-dismissed") !== "1") setWalletDialogOpen(true);
      }
    }
    void checkWallet();
    provider?.on?.("accountsChanged", onAccountsChanged);
    return () => {
      live = false;
      provider?.removeListener?.("accountsChanged", onAccountsChanged);
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setActiveSection(window.location.hash || "#overview");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const visiblePositions = useMemo(() => positions.filter((position) => `${position.pair} ${position.pool} ${position.status}`.toLowerCase().includes(positionSearch.toLowerCase())), [positionSearch]);
  const visibleUpdates = updates.filter((item) => (activityRange === "This week" || item.day === activityRange) && `${item.title} ${item.detail}`.toLowerCase().includes(activitySearch.toLowerCase()));
  const visibleMainNav = mainNavigation.filter((item) => item.label.toLowerCase().includes(navSearch.toLowerCase()));
  const visibleInsightNav = insightNavigation.filter((item) => item.label.toLowerCase().includes(navSearch.toLowerCase()));

  function dismissWalletPrompt() {
    sessionStorage.setItem("nacre-wallet-prompt-dismissed", "1");
    setWalletDialogOpen(false);
    setWalletError("");
  }

  async function connectWallet() {
    if (!window.ethereum) {
      setWalletError("No browser wallet was found. You can still explore the demo data.");
      return;
    }
    setConnecting(true);
    setWalletError("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (accounts[0]) {
        sessionStorage.removeItem("nacre-wallet-manually-disconnected");
        setWalletAccount(accounts[0]);
        setWalletDialogOpen(false);
      }
    } catch {
      setWalletError("The connection was not completed. You can continue with demo data.");
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectWallet() {
    sessionStorage.setItem("nacre-wallet-manually-disconnected", "1");
    setWalletAccount(null);
    setWalletError("");
    try {
      await window.ethereum?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Some injected wallets do not expose permission revocation; the app still disconnects for this session.
    }
  }

  function navLink(item: (typeof mainNavigation)[number]) {
    const Icon = item.icon;
    return <a key={item.href + item.label} href={item.href} className={`kd-nav-link${activeSection === item.href ? " is-active" : ""}`} aria-current={activeSection === item.href ? "page" : undefined} onClick={() => { setActiveSection(item.href); setMobileNavOpen(false); }} title={sidebarCollapsed ? item.label : undefined}><Icon size={17} aria-hidden="true" /><span>{item.label}</span></a>;
  }

  return (
    <div className={`dashboard${sidebarCollapsed ? " is-collapsed" : ""}`} id="overview">
      {mobileNavOpen && <button className="kd-sidebar-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside className={`kd-sidebar${mobileNavOpen ? " is-open" : ""}`} aria-label="Dashboard navigation">
        <div className="kd-sidebar-brand-row"><Link href="/" className="kd-brand" aria-label="Nacre home"><span className="kd-brand-icon"><NacreMark /></span><span>Nacre</span></Link><button className="kd-collapse-button" type="button" aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="kd-mobile-close" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X size={18} /></button></div>
        <label className="kd-sidebar-search"><Search size={17} aria-hidden="true" /><input type="search" aria-label="Search navigation" placeholder="Search anything" value={navSearch} onChange={(event) => setNavSearch(event.target.value)} /><kbd>⌘ K</kbd></label>
        <nav className="kd-sidebar-nav"><div className="kd-nav-group"><p>MAIN NAVIGATION</p>{visibleMainNav.map(navLink)}</div><div className="kd-nav-group"><p>ANALYTICS &amp; INSIGHTS</p>{visibleInsightNav.map(navLink)}</div><div className="kd-nav-group kd-support-nav"><p>SUPPORT</p><Link href="/#model" className="kd-nav-link"><CircleHelp size={17} /><span>How Nacre works</span></Link><Link href="/" className="kd-nav-link"><ArrowUpRight size={17} /><span>Back to website</span></Link></div></nav>
        {walletAccount ? (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><button className="kd-account-card" type="button" aria-label="Wallet menu"><span className="kd-account-avatar"><NacreMark /></span><span><strong>{shortAddress(walletAccount)}</strong><small>Wallet connected</small></span><ChevronDown size={16} aria-hidden="true" /></button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="kd-account-menu" side="top" align="start" sideOffset={8}><p>CONNECTED WALLET</p><span className="kd-menu-address">{shortAddress(walletAccount)}</span><DropdownMenu.Separator /><DropdownMenu.Item className="kd-disconnect-item" onSelect={() => void disconnectWallet()}><LogOut size={15} /> Disconnect wallet</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : <button className="kd-account-card" type="button" onClick={() => setWalletDialogOpen(true)}><span className="kd-account-avatar">DE</span><span><strong>Demo workspace</strong><small>Connect wallet to begin</small></span><ChevronDown size={16} aria-hidden="true" /></button>}
      </aside>

      <main className="kd-main">
        <header className="kd-topbar"><div className="kd-breadcrumb"><button className="kd-mobile-menu" type="button" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button><LayoutGrid size={17} aria-hidden="true" /><span>Overview</span><span className="kd-breadcrumb-slash">/</span><strong>Dashboard</strong></div><div className="kd-topbar-actions"><a href="#activity" aria-label="View activity" onClick={() => setActiveSection("#activity")}><Bell size={17} /></a></div></header>
        <div className="kd-content">
          <div className="kd-page-intro"><div><h1>Hello, liquidity provider <span aria-hidden="true">✳</span></h1><p>Here is the latest picture of your fee income and protection.</p></div><div className="kd-page-actions"><label className="kd-period-select"><CalendarDays size={16} /><select aria-label="Time range" value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option></select><ChevronDown size={14} /></label></div></div>

          <div className="kd-overview-grid"><div className="kd-primary-column"><div className="kd-metrics-grid"><MetricCard title="Eligible Fees" value="$2,482" change="+12.8%" context="last 7 days" icon={Activity} values={[18, 23, 21, 28, 26, 33, 30]} /><MetricCard title="Protected Floor" value="$3,100" change="3 positions" context="currently covered" icon={ShieldCheck} values={[18, 18, 21, 22, 26, 26, 28]} /><MetricCard title="Open Shortfall" value="$617" change="19.9%" context="eligible for cover" icon={ArrowDownRight} values={[31, 29, 26, 27, 23, 21, 19]} muted /></div>
            <Card className="kd-card kd-trend-panel" id="analytics"><div className="kd-card-heading"><h2><Activity size={17} /> Fee Income Trend</h2><label className="kd-small-select"><CalendarDays size={15} /><select aria-label="Chart range" value={period} onChange={(event) => setPeriod(event.target.value as Period)}><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option><option value="90D">Last 90 days</option></select><ChevronDown size={13} /></label></div><div className="kd-trend-inner"><div className="kd-trend-summary"><strong>{chartSeries[period].total}</strong><span>{chartSeries[period].change}</span><small>vs previous period</small></div><FeeBars period={period} /></div></Card></div>

            <Card className="kd-card kd-updates-panel" id="activity"><div className="kd-card-heading"><h2>Latest Updates</h2><Activity size={16} aria-hidden="true" /></div><div className="kd-updates-inner"><div className="kd-update-tabs" role="group" aria-label="Activity range">{(["Today", "Yesterday", "This week"] as ActivityRange[]).map((item) => <button key={item} type="button" className={activityRange === item ? "is-active" : ""} aria-pressed={activityRange === item} onClick={() => setActivityRange(item)}>{item}</button>)}</div><label className="kd-activity-search"><Search size={17} /><input type="search" aria-label="Search activities" placeholder="Search activities" value={activitySearch} onChange={(event) => setActivitySearch(event.target.value)} /></label><p className="kd-update-count"><strong>{visibleUpdates.length}</strong> illustrative updates {activityRange === "This week" ? "this week" : activityRange.toLowerCase()}</p><div className="kd-update-list">{visibleUpdates.map((item) => { const Icon = item.icon; return <div className="kd-update-item" key={item.title}><span className={`kd-update-icon ${item.tone}`}><Icon size={16} /></span><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{item.time}</time></div>; })}{visibleUpdates.length === 0 && <p className="kd-empty-updates">No updates match your search.</p>}</div></div></Card></div>

          <section className="kd-data-section" id="positions"><Card className="kd-card kd-table-panel"><div className="kd-card-heading"><h2><Layers3 size={17} /> Position Monitoring</h2><label className="kd-table-search"><Search size={16} /><input type="search" aria-label="Search positions" placeholder="Search positions" value={positionSearch} onChange={(event) => setPositionSearch(event.target.value)} /></label></div><div className="kd-table-inner"><div className="kd-table-scroll"><table><thead><tr><th>POSITION</th><th>ACTIVE RANGE</th><th>ELIGIBLE FEES</th><th>FEE FLOOR</th><th>STATUS</th><th aria-label="Details" /></tr></thead><tbody>{visiblePositions.map((position) => <tr key={position.pair}><td><div className="kd-pair-cell"><span className="kd-token">{position.mark}</span><span><strong>{position.pair}</strong><small>{position.pool}</small></span></div></td><td>{position.range}</td><td>{position.fees}</td><td>{position.floor}</td><td><span className={`kd-status${position.status === "Near edge" ? " is-warning" : ""}`}>{position.status}</span></td><td><a href="#market" aria-label={`See cover quotes for ${position.pair}`}><ArrowUpRight size={16} /></a></td></tr>)}</tbody></table>{visiblePositions.length === 0 && <div className="kd-table-empty">No positions match “{positionSearch}”.</div>}</div></div></Card></section>

          <section className="kd-market-section" id="market"><div className="kd-market-intro"><div><h2>Cover Market</h2><p>Compare sample underwriter terms for the same fee floor.</p></div><span>BEST QUOTED PREMIUM <strong>2.4%</strong></span></div><div className="kd-quote-grid">{quotes.map((quote) => <Card className={`kd-card kd-quote-card${selectedQuote === quote.name ? " is-selected" : ""}`} key={quote.name}><div className="kd-card-heading"><h3>{quote.name}</h3><span>{quote.note}</span></div><div className="kd-quote-inner"><span className="kd-quote-mark">{quote.initials}</span><div><strong>{quote.premium}</strong><small>premium of floor</small></div><p>Capacity <b>{quote.capacity}</b></p><button type="button" onClick={() => setSelectedQuote(quote.name)}>{selectedQuote === quote.name ? <>Selected for review <Check size={15} /></> : <>Review quote <ArrowRight size={15} /></>}</button></div></Card>)}</div><p className="kd-demo-note"><CircleHelp size={14} /> Illustrative positions and quotes only. No live cover is offered on this page.</p></section>
        </div>
      </main>

      <Dialog.Root open={walletDialogOpen} onOpenChange={(open) => { if (!open) dismissWalletPrompt(); else setWalletDialogOpen(true); }}><Dialog.Portal><Dialog.Overlay className="kd-wallet-overlay" /><Dialog.Content className="kd-wallet-dialog"><button className="kd-wallet-close" type="button" aria-label="Close wallet prompt" onClick={dismissWalletPrompt}><X size={18} /></button><span className="kd-dialog-logo"><NacreMark /></span><Dialog.Title>Explore Nacre with a wallet</Dialog.Title><Dialog.Description>Connect when you are ready. You can dismiss this window and explore sample positions, fee data, and cover quotes now.</Dialog.Description>{walletError && <p className="kd-wallet-error" role="alert">{walletError}</p>}<Button className="kd-dialog-connect" onClick={connectWallet} disabled={connecting}><Wallet size={16} /> {connecting ? "Connecting…" : "Connect wallet"}</Button><button className="kd-dialog-skip" type="button" onClick={dismissWalletPrompt}>Continue with demo <ArrowRight size={16} /></button><p className="kd-dialog-note">No signature is needed to view the dashboard.</p></Dialog.Content></Dialog.Portal></Dialog.Root>
    </div>
  );
}
