"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ShieldCheck, ExternalLink, LoaderCircle } from "lucide-react";
import { formatUnits, parseUnits, type Address, type Hex } from "viem";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { baseClient, injectedClient, ensureBaseSepolia, erc20Abi, priceToRawTick, basescanTx } from "@/lib/nacre-chain";
import { LEGACY_WETH_POOL, testPool } from "@/lib/test-pools";
import { COVERAGE_APP, COVERAGE_TOKEN, COVERAGE_VAULT, COVERAGE_POSITIONS,
  coverageVaultAbi, coverageNftAbi, coverageAppAbi, rangeFactoryAbi, rangeOfferAbi,
  tickPrice, type CoverageOffer, type CoverageRequest, type CoverageSnapshot } from "@/lib/coverage-contracts";
import { availableBid, bidMatchesPosition } from "@/lib/funded-bids";
import { useCoverage, refreshCoverage } from "@/lib/use-coverage";

const amount = (raw: string | bigint) => Number(formatUnits(BigInt(raw), 6)).toLocaleString("en-US", { maximumFractionDigits: 4 });
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const same = (a: string, b?: string | null) => !!b && a.toLowerCase() === b.toLowerCase();
const statuses = ["Unknown", "Awaiting purchase", "Covered", "Settled", "Cancelled"];
const rangeText = (lower: number, upper: number) => `${dollars(tickPrice(lower))} – ${dollars(tickPrice(upper))}`;
const durationOptions = [7, 14, 30, 60, 90];
function matches(offer: CoverageOffer, request: CoverageRequest) {
  return offer.poolId === request.poolId && !offer.closed && offer.tickLower === request.tickLower && offer.tickUpper === request.tickUpper
    && offer.duration === request.duration && BigInt(offer.available) >= BigInt(request.payoutCap)
    && !same(offer.owner, request.lp);
}
export function useCoverageAction(account: string | null) {
  const lock = useRef(false);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const run = async (action: (owner: Address) => Promise<void>) => {
    if (!account || lock.current) return;
    lock.current = true; setStep("Checking wallet…"); setError(""); setSuccess(""); setHash(null);
    try {
      await ensureBaseSepolia();
      const [owner] = await injectedClient().getAddresses();
      if (!same(owner, account)) throw new Error("Wallet account changed. Reconnect before continuing.");
      await action(owner);
      setSuccess("Transaction confirmed on Base Sepolia.");
      refreshCoverage();
    } catch (reason) {
      setError((reason as { shortMessage?: string }).shortMessage ?? (reason instanceof Error ? reason.message : "Transaction failed."));
    } finally { lock.current = false; setStep(""); }
  };
  const confirm = async (hash: Hex) => {
    setHash(hash);
    const receipt = await baseClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error("Transaction reverted. Your coverage state has not changed.");
    return receipt;
  };
  const approve = async (owner: Address, spender: Address, value: bigint) => {
    const [balance, allowance] = await Promise.all([
      baseClient.readContract({ address: COVERAGE_TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
      baseClient.readContract({ address: COVERAGE_TOKEN, abi: erc20Abi, functionName: "allowance", args: [owner, spender] }),
    ]);
    if (balance < value) throw new Error(`You need ${amount(value)} nUSDC; your wallet has ${amount(balance)}.`);
    if (allowance >= value) return;
    setStep("Approve nUSDC in your wallet…");
    await confirm(await injectedClient().writeContract({ account: owner, address: COVERAGE_TOKEN,
      abi: erc20Abi, functionName: "approve", args: [spender, value] }));
  };
  return { run, confirm, approve, setStep, busy: !!step, step,
    feedback: <>{step && <p className="cw-feedback" role="status"><LoaderCircle size={14} className="animate-spin" />{step}</p>}
      {error && <p className="mw-premium-warning" role="alert">{error}</p>}
      {success && <p className="cw-feedback" role="status">{success}</p>}
      {hash && <a className="mw-evidence-link" href={basescanTx(hash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={13} /></a>}</> };
}

export function CoverageFunding({ account, onConnect, lower, upper, poolId, initialDays = 30, initialCapital = "100" }: {
  account: string | null; onConnect: () => Promise<void>; lower: number; upper: number; poolId?: string; initialDays?: number; initialCapital?: string;
}) {
  const { data, error } = useCoverage(poolId);
  const RANGE_FACTORY = data?.poolConfig?.factory ?? testPool(poolId)?.factory;
  const action = useCoverageAction(account);
  const [capital, setCapital] = useState(initialCapital);
  const [days, setDays] = useState(initialDays);
  const [rate, setRate] = useState("8");
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    let active = true;
    if (!account) return;
    void baseClient.readContract({ address: COVERAGE_TOKEN, abi: erc20Abi,
      functionName: "balanceOf", args: [account as Address] })
      .then((value) => { if (active) setBalance(value); })
      .catch(() => { if (active) setBalance(null); });
    return () => { active = false; };
  }, [account, data?.blockNumber]);
  const tickLower = priceToRawTick(lower);
  const tickUpper = priceToRawTick(upper);
  const bps = Math.round(Number(rate) * 100);
  const valid = /^\d+(\.\d{1,6})?$/.test(capital) && Number(capital) > 0
    && Number.isFinite(bps) && bps > 0 && bps <= 10000 && tickLower < tickUpper;
  const fund = () => action.run(async (owner) => {
    if (!valid || !data?.configured || error) throw new Error("Enter valid terms and wait for the live coverage connection.");
    const value = parseUnits(capital, 6);
    if (!RANGE_FACTORY) throw new Error("Select a deployed pool first.");
    await action.approve(owner, RANGE_FACTORY, value);
    action.setStep("Fund this range in your wallet…");
    await action.confirm(await injectedClient().writeContract({ account: owner, address: RANGE_FACTORY,
      abi: rangeFactoryAbi, functionName: "createOffer", args: [value, tickLower, tickUpper, days * 86400, bps] }));
  });
  return <Card className="kd-card mw-trade-card"><div className="kd-card-heading"><h2><ShieldCheck size={16} /> Post a funded bid</h2><span>FUNDED ON-CHAIN</span></div>
    <div className="mw-trade-inner">
      <p>Fund the selected bins. Each matching LP purchases cover for the duration and premium you set.</p>
      <div className="cw-terms"><strong>{rangeText(tickLower, tickUpper)}</strong><span>Ticks {tickLower} to {tickUpper} · {(tickUpper - tickLower) / 10} bins</span></div>
      {account && <small>Wallet balance: {balance === null ? "…" : amount(balance)} nUSDC</small>}
      <fieldset disabled={action.busy} className="cw-fields">
        <label className="mw-field"><span>Coverage capital (nUSDC)</span><Input type="number" min="0.000001" step="0.000001" value={capital} onChange={(event) => setCapital(event.target.value)} /></label>
        <label className="mw-field"><span>Coverage duration</span><select value={days} onChange={(event) => setDays(Number(event.target.value))}>{durationOptions.map((value) => <option key={value} value={value}>{value} days</option>)}</select></label>
        <label className="mw-field"><span>Premium · % of each protected fee cap</span><Input type="number" min="0.01" max="100" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
      </fieldset>
      <div className="cw-terms"><span>For a 10 nUSDC cap over {days} days</span><strong>{Number.isFinite(bps) ? (10 * bps / 10000).toFixed(2) : "—"} nUSDC premium</strong></div>
      {valid && <div className="mw-underwriter-sim"><div><span>Premium if all capacity is purchased once</span><strong>{(Number(capital) * bps / 10000).toFixed(4)} nUSDC</strong></div><div><span>Net loss if those claims use every cap</span><strong>{(Number(capital) * (1 - bps / 10000)).toFixed(4)} nUSDC</strong></div></div>}
      <p className="mw-risk-note">Premiums are earned when an LP buys coverage. Claims can consume the full cap. Unused capital can be withdrawn; active collateral stays reserved until settlement.</p>
      {error && <p role="alert" className="mw-premium-warning">{error}</p>}
      {!account ? <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet to fund</Button>
        : <Button className="kd-apply-button" disabled={action.busy || !valid || !data?.configured || !!error} onClick={() => void fund()}>{action.busy ? action.step : "Fund bid for these bins"}</Button>}
      {action.feedback}
      <Button asChild variant="outline" className="mw-faucet-link"><Link href="/dashboard/faucet">Get test nUSDC</Link></Button>
    </div></Card>;
}

export function CoverageRequestForm({ poolId, bidAddress, account, days, feeTarget, maximumTarget, refreshKey }: {
  poolId?: string; bidAddress?: string; account: string | null; days: number; feeTarget?: number; maximumTarget?: number; refreshKey: number;
}) {
  const { data, error } = useCoverage(poolId);
  const action = useCoverageAction(account);
  const [chosen, setChosen] = useState("");
  const selectedBid = data?.offers.find((offer) => same(offer.address, bidAddress));
  const owned = data?.positions.filter((position) => same(position.owner, account) && (!bidAddress || (!!selectedBid && bidMatchesPosition(selectedBid, position)))) ?? [];
  const selected = owned.find((position) => position.tokenId === chosen) ?? owned.at(-1);
  const inRange = !!selected && !!data && data.currentTick >= selected.tickLower && data.currentTick < selected.tickUpper;
  const availableOffers = selected && feeTarget ? data?.offers.filter((offer) => offer.poolId === selected.poolId && !offer.closed && (!bidAddress || same(offer.address, bidAddress))
    && !same(offer.owner, account) && offer.tickLower === selected.tickLower && offer.tickUpper === selected.tickUpper
    && offer.duration === days * 86400 && BigInt(offer.available) >= parseUnits(feeTarget.toFixed(6), 6)) ?? [] : [];
  const ownRangeOffer = !!selected && !!data?.offers.some((offer) => offer.poolId === selected.poolId
    && same(offer.owner, account) && !offer.closed && offer.tickLower === selected.tickLower && offer.tickUpper === selected.tickUpper);
  const valid = !!account && !!data?.configured && !!feeTarget && Number.isFinite(feeTarget)
    && !!maximumTarget && feeTarget > 0 && feeTarget <= maximumTarget && inRange && durationOptions.includes(days) && availableOffers.length > 0;
  // refreshKey changes after the parent registers a newly confirmed mint.
  useEffect(() => { refreshCoverage(); }, [refreshKey]);
  const request = () => action.run(async (owner) => {
    if (!selected || !valid || !feeTarget || error) throw new Error("Choose an owned position and a valid fee target.");
    const id = BigInt(selected.tokenId);
    const checkBid = async () => {
      const response = await fetch(`/api/workspace/coverage?fresh=1&poolId=${poolId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not verify funded bids. Try again.");
      const fresh = await response.json() as CoverageSnapshot;
      if (!fresh.offers.some((offer) => (!bidAddress || same(offer.address, bidAddress))
        && bidMatchesPosition(offer, selected) && offer.duration === days * 86400
        && availableBid(offer, fresh.currentTick, owner, parseUnits(feeTarget.toFixed(6), 6)))) {
        throw new Error("No funded bid is available for this position and fee cap. Choose another bid.");
      }
    };
    await checkBid();
    if (availableOffers.length) {
      const limits = await Promise.all(availableOffers.map((offer) => baseClient.readContract({
        address: offer.address, abi: rangeOfferAbi, functionName: "maximumCap", args: [id],
      })));
      const maximum = limits.reduce((a, b) => a > b ? a : b, BigInt(0));
      if (parseUnits(feeTarget.toFixed(6), 6) > maximum) throw new Error(`This position can protect at most ${amount(maximum)} nUSDC for ${days} days. Lower your fee target.`);
    }
    const [nftOwner, approved, info] = await Promise.all([
      baseClient.readContract({ address: COVERAGE_POSITIONS, abi: coverageNftAbi, functionName: "ownerOf", args: [id] }),
      baseClient.readContract({ address: COVERAGE_POSITIONS, abi: coverageNftAbi, functionName: "getApproved", args: [id] }),
      baseClient.readContract({ address: COVERAGE_POSITIONS, abi: coverageNftAbi, functionName: "getPoolAndPositionInfo", args: [id] }),
    ]);
    if (!same(nftOwner, owner)) throw new Error("This position is no longer in your wallet.");
    if (!same(approved, COVERAGE_VAULT)) {
      action.setStep("Approve this LP position for coverage…");
      await action.confirm(await injectedClient().writeContract({ account: owner, address: COVERAGE_POSITIONS,
        abi: coverageNftAbi, functionName: "approve", args: [COVERAGE_VAULT, id] }));
    }
    await checkBid();
    action.setStep("Create your coverage request…");
    const cap = parseUnits(feeTarget.toFixed(6), 6);
    await action.confirm(await injectedClient().writeContract({ account: owner, address: COVERAGE_VAULT,
      abi: coverageVaultAbi, functionName: "createRequest",
      args: [info[0], id, cap, cap, days * 86400, BigInt(Math.floor(Date.now() / 1000) + 3600)] }));
  });
  return <div id="protect-lp-fees" className="mw-onchain-lp"><strong>Protect your LP fees</strong>
    {!owned.length ? <p>Mint a position above first. Its actual bins are used for coverage.</p> : <>
      <label className="mw-field"><span>Position to protect</span><select disabled={action.busy} value={selected?.tokenId ?? ""} onChange={(event) => setChosen(event.target.value)}>{owned.map((position) => <option key={position.tokenId} value={position.tokenId}>Position #{position.tokenId}</option>)}</select></label>
      {selected && <div className="cw-terms"><span>{rangeText(selected.tickLower, selected.tickUpper)}</span><strong>{feeTarget?.toFixed(4) ?? "—"} nUSDC fee target · {days} days</strong><span>{(selected.tickUpper - selected.tickLower) / 10} bins · ticks {selected.tickLower} to {selected.tickUpper}</span></div>}
      {inRange && !availableOffers.length && <p className="mw-premium-warning">{ownRangeOffer ? "Your wallet funded this range. The contract requires a different wallet to underwrite your position." : "No funded bid is available for these terms. Choose a bid with enough available cover."}</p>}
      {!inRange && <p className="mw-premium-warning">New coverage is unavailable while this position is out of range.</p>}
      {feeTarget !== undefined && maximumTarget !== undefined && feeTarget > maximumTarget && <p className="mw-premium-warning">Lower the fee target to {maximumTarget.toFixed(4)} nUSDC or less.</p>}
      <p>Submitting transfers your LP position to the policy vault immediately. If you do not buy coverage, you can reclaim it after one hour. A request alone does not protect your fees.</p>
      <Button className="kd-apply-button" disabled={action.busy || !valid || !!error} onClick={() => void request()}>{action.busy ? action.step : "Request coverage for this position"}</Button>
    </>}{error && <p className="mw-premium-warning">{error}</p>}{action.feedback}
  </div>;
}

function CoveragePolicy({ request, offers, account, now, currentTick, disabled, role = "lp" }: {
  role?: "lp" | "underwriter"; request: CoverageRequest; offers: CoverageOffer[]; account: string | null; now: number; currentTick: number; disabled: boolean;
}) {
  const action = useCoverageAction(account);
  const available = offers.filter((offer) => matches(offer, request));
  const canBuy = request.status === 1 && request.quoteDeadline > now && currentTick >= request.tickLower && currentTick < request.tickUpper;
  const buy = (offer: CoverageOffer) => action.run(async (owner) => {
    action.setStep("Prepare the matched range offer…");
    await action.confirm(await injectedClient().writeContract({ account: owner, address: offer.address,
      abi: rangeOfferAbi, functionName: "publish", args: [BigInt(request.id)] }));
    const quote = await baseClient.readContract({ address: offer.address, abi: rangeOfferAbi, functionName: "quoteFor", args: [BigInt(request.id)] });
    await action.approve(owner, COVERAGE_APP, quote.premium);
    const fillable = await baseClient.readContract({ address: COVERAGE_APP, abi: coverageAppAbi, functionName: "canFill", args: [quote] });
    if (!fillable) throw new Error("This offer is no longer available. Refresh to choose another.");
    action.setStep("Pay premium and activate coverage…");
    await action.confirm(await injectedClient().writeContract({ account: owner, address: COVERAGE_APP,
      abi: coverageAppAbi, functionName: "buyCoverage", args: [quote] }));
  });
  const finish = (functionName: "settle" | "cancel") => action.run(async (owner) => {
    action.setStep(functionName === "settle" ? "Settle coverage and return the position…" : "Return the unfilled position…");
    await action.confirm(await injectedClient().writeContract({ account: owner, address: COVERAGE_VAULT,
      abi: coverageVaultAbi, functionName, args: [BigInt(request.id)] }));
  });
  return <div className="cw-policy"><div className="cw-row"><strong>Position #{request.tokenId} · {request.duration / 86400} days</strong><span>{statuses[request.status]}</span></div>
    <p>{rangeText(request.tickLower, request.tickUpper)} · {(request.tickUpper - request.tickLower) / 10} bins</p>
    <div className="cw-row"><span>Protected fee cap <strong>{amount(request.payoutCap)} nUSDC</strong></span><span>Premium paid <strong>{amount(request.premium)} nUSDC</strong></span></div>
    {request.status === 2 && <small>Coverage ends {new Date(request.endAt * 1000).toLocaleString()}. Settle at expiry; eligible fees are measured when settlement executes.</small>}
    {role === "underwriter" && request.status === 1 && request.quoteDeadline > now && <>
      <p>Awaiting a funded offer and the LP’s premium payment. This request is not covered yet.</p>
      <small>Request expires {new Date(request.quoteDeadline * 1000).toLocaleString()}</small>
      {same(request.lp, account) ? <p className="mw-risk-note">You submitted this request. Connect a different wallet to fund it as an underwriter.</p>
        : !account ? <p>Connect an underwriter wallet to fund this request.</p>
        : <details><summary>Fund this request’s bins and duration</summary>
          <CoverageFunding key={request.id} account={account} onConnect={async () => {}} poolId={request.poolId}
            lower={tickPrice(request.tickLower)} upper={tickPrice(request.tickUpper)} initialDays={request.duration / 86400}
            initialCapital={formatUnits(BigInt(request.payoutCap), 6)} />
        </details>}
    </>}
    {role === "lp" && request.status === 1 && same(request.lp, account) && <>
      <small>Unfilled request deadline: {new Date(request.quoteDeadline * 1000).toLocaleString()}</small>
      {canBuy && available.map((offer) => <div className="cw-offer-choice" key={offer.address}><span>{offer.premiumBps / 100}% premium · <strong>{amount((BigInt(request.payoutCap) * BigInt(offer.premiumBps) + BigInt(9999)) / BigInt(10000))} nUSDC</strong></span><Button className="kd-apply-button" disabled={action.busy || disabled} onClick={() => void buy(offer)}>Buy coverage</Button></div>)}
      {canBuy && !available.length && <p>No funded offer matches these bins, days, and cap yet.</p>}
      {!canBuy && now <= request.quoteDeadline && <p>Coverage cannot start while the position is outside its range.</p>}
      {now > request.quoteDeadline && <Button variant="outline" disabled={action.busy || disabled} onClick={() => void finish("cancel")}>Reclaim unfilled position</Button>}
    </>}
    {request.status === 2 && now >= request.endAt && account && <Button className="kd-apply-button" disabled={action.busy || disabled} onClick={() => void finish("settle")}>Settle coverage</Button>}
    {action.feedback}
  </div>;
}

export function OfferRow({ offer, account, disabled, onChoose, canManage }: { offer: CoverageOffer; account: string | null; disabled: boolean; canManage: boolean; onChoose?: (offer: CoverageOffer) => void }) {
  const action = useCoverageAction(account);
  return <div className="cw-policy"><div className="cw-row"><strong>{offer.duration / 86400} days · {offer.premiumBps / 100}% premium</strong><span>{offer.closed ? "Closed to new coverage" : "Funded offer"}</span></div>
    <p>{testPool(offer.poolId)?.symbol ?? "nWETH"} / nUSDC · {rangeText(offer.tickLower, offer.tickUpper)} · {(offer.tickUpper - offer.tickLower) / 10} bins</p>
    {offer.poolId === LEGACY_WETH_POOL && !offer.closed && <p className="mw-risk-note">This offer backs the old WETH pool only. To back nWETH positions, withdraw unused funds and fund their exact bins in the nWETH pool.</p>}
    <div className="cw-row"><span>Available <strong>{amount(offer.available)} nUSDC</strong></span><a href={`https://sepolia.basescan.org/address/${offer.address}`} target="_blank" rel="noreferrer">Contract <ExternalLink size={12} /></a></div>
    {onChoose && !offer.closed && BigInt(offer.available) > BigInt(0) && !same(offer.owner, account) && <Button variant="outline" onClick={() => onChoose(offer)}>Use these bins & duration</Button>}
    {canManage && same(offer.owner, account) && (!offer.closed || BigInt(offer.available) > BigInt(0)) && <Button variant="outline" disabled={action.busy || disabled} onClick={() => void action.run(async (owner) => {
      action.setStep("Withdraw available funds…");
      await action.confirm(await injectedClient().writeContract({ account: owner, address: offer.address,
        abi: rangeOfferAbi, functionName: "closeAndWithdraw" }));
    })}>{offer.closed ? "Withdraw settlement refund" : "Close offer & withdraw unused funds"}</Button>}{action.feedback}
  </div>;
}

export function CoverageBoard({ account, role, portfolio = false, onChoose, poolId }: { account: string | null; role: "lp" | "underwriter"; portfolio?: boolean; poolId?: string; onChoose?: (offer: CoverageOffer) => void }) {
  const { data, error, now, refresh } = useCoverage(poolId);
  const showOffers = !portfolio || role === "underwriter";
  const offers = data?.offers.filter((offer) => portfolio ? same(offer.owner, account)
    : role === "lp" ? !offer.closed && BigInt(offer.available) > BigInt(0) && !same(offer.owner, account) : true) ?? [];
  const myOffers = data?.offers.filter((offer) => same(offer.owner, account)) ?? [];
  const mine = new Set(myOffers.map((offer) => offer.address.toLowerCase()));
  const requests = data?.requests.filter((request) => role === "lp" ? same(request.lp, account)
    : portfolio ? mine.has(request.underwriter.toLowerCase()) || (request.status === 1 && request.quoteDeadline > now) : true) ?? [];
  return <Card className="kd-card cw-board"><div className="kd-card-heading"><h2><ShieldCheck size={16} />{portfolio ? role === "lp" ? "Your fee protection" : "Underwriting portfolio" : "Live coverage market"}</h2><button onClick={() => void refresh()} type="button">Refresh</button></div>
    <div className="mw-trade-inner">{error && <p className="mw-premium-warning" role="alert">{error}</p>}
      {!data ? <p>Loading Base Sepolia coverage…</p> : <>
        {showOffers && <>
          <h3>{portfolio ? "Your funded offers" : "Available funded ranges"}</h3>
          {!offers.length && <p>{role === "lp" ? "No funded coverage is available for purchase yet." : "No funded ranges yet. Fund selected bins from a pool’s underwriting form."}</p>}
          {offers.map((offer) => <OfferRow key={offer.address} offer={offer} account={account} disabled={!!error} canManage={role === "underwriter"} onChoose={onChoose} />)}
        </>}
        <h3>{role === "lp" ? "Your requests and policies" : `Open requests · ${requests.filter((request) => request.status === 1 && request.quoteDeadline > now).length} · Your policies`}</h3>
        {!requests.length && <p>{!account ? "Connect a wallet to view your requests." : role === "lp" ? "Coverage you request or buy for your LP positions will appear here." : "No open coverage requests or policies backed by your offers yet."}</p>}
        {requests.map((request) => <CoveragePolicy key={request.id} role={role} request={request} offers={data.offers} account={account} now={now} currentTick={data.poolTicks[request.poolId] ?? data.currentTick} disabled={!!error} />)}
        {role === "underwriter" && <>
          <h3>Registered LP positions · {data.positions.length}</h3>
          <p>Minting creates liquidity. Coverage starts after the LP requests a fee cap and duration, then pays a matching offer’s premium.</p>
          {data.positions.map((position) => {
            const policy = data.requests.find((request) => request.tokenId === position.tokenId && request.status === 2);
            const pending = data.requests.find((request) => request.tokenId === position.tokenId && request.status === 1 && request.quoteDeadline > now);
            const ownPosition = same(policy?.lp ?? pending?.lp ?? position.owner, account);
            const fundedBins = myOffers.some((offer) => offer.poolId === position.poolId && !offer.closed
              && BigInt(offer.available) > BigInt(0) && offer.tickLower === position.tickLower && offer.tickUpper === position.tickUpper);
            return <div className="cw-policy" key={position.tokenId}>
              <div className="cw-row"><strong>Position #{position.tokenId} · {testPool(position.poolId)?.symbol ?? "nWETH"} / nUSDC</strong><span>{policy ? "Covered" : pending ? "Coverage requested" : "No coverage requested"}</span></div>
              <p>{rangeText(position.tickLower, position.tickUpper)} · {(position.tickUpper - position.tickLower) / 10} bins</p>
              {!policy && <small>{ownPosition ? "Owned by your connected wallet. Another wallet must underwrite it; switching dashboard roles does not change your wallet." : fundedBins ? "Your offer covers these bins. The LP must choose matching days and a fee cap within your available capital, then purchase coverage." : "You have no funded offer for this pool and these exact bins."}</small>}
            </div>;
          })}
          {!data.positions.length && <p>No registered LP positions in this pool yet.</p>}
        </>}
      </>}
    </div></Card>;
}

export function CoverageStats({ account }: { account: string | null }) {
  const { data, error } = useCoverage();
  const offers = data?.offers.filter((offer) => same(offer.owner, account)) ?? [];
  const addresses = new Set(offers.map((offer) => offer.address.toLowerCase()));
  const policies = data?.requests.filter((request) => addresses.has(request.underwriter.toLowerCase())) ?? [];
  const sum = (rows: string[]) => rows.reduce((total, value) => total + BigInt(value), BigInt(0));
  const values = [
    ["AVAILABLE CAPITAL", sum(offers.map((offer) => offer.available))],
    ["RESERVED FOR COVER", sum(policies.filter((policy) => policy.status === 2).map((policy) => policy.payoutCap))],
    ["PREMIUMS RECEIVED", sum(policies.filter((policy) => policy.status >= 2 && policy.status <= 3).map((policy) => policy.premium))],
  ] as const;
  return <div className="mw-stats">{values.map(([label, value]) => <Card className="kd-card" key={label}><div className="mw-stat"><span>{label}</span><strong>{!account || !data || error ? "—" : amount(value)}</strong><small>nUSDC · Base Sepolia</small></div></Card>)}</div>;
}

// Recovery is separate from active pool statistics and loaded only when opened.
export function ArchivedCoverageRecovery({ account }: { account: string | null }) {
  const [open, setOpen] = useState(false);
  if (!account) return null;
  return <details className="kd-card cw-board" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="kd-card-heading">Recover funds from archived pools</summary>
    {open && <ArchivedCoverageFunds account={account} />}
  </details>;
}

function ArchivedCoverageFunds({ account }: { account: string }) {
  const { data, error, now } = useCoverage(LEGACY_WETH_POOL);
  const offers = data?.offers.filter((offer) => same(offer.owner, account)) ?? [];
  const mine = new Set(offers.map((offer) => offer.address.toLowerCase()));
  const policies = data?.requests.filter((request) => request.status === 2 && mine.has(request.underwriter.toLowerCase())) ?? [];
  return <div className="mw-trade-inner">
    <p>Archived funds are excluded from your active portfolio. Withdraw available capital here; reserved collateral remains locked until settlement.</p>
    {error && <p role="alert" className="mw-premium-warning">{error}</p>}
    {!data ? <p>Loading archived funds…</p> : <>
      {offers.filter((offer) => !offer.closed || BigInt(offer.available) > BigInt(0)).map((offer) => <OfferRow key={offer.address} offer={offer} account={account} disabled={!!error} canManage />)}
      {policies.map((request) => <CoveragePolicy key={request.id} request={request} offers={offers} account={account} now={now} currentTick={data.currentTick} disabled={!!error} />)}
      {!offers.some((offer) => !offer.closed || BigInt(offer.available) > BigInt(0)) && !policies.length && <p>No remaining underwriting funds in archived pools.</p>}
    </>}
  </div>;
}
