"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleHelp, Coins, ExternalLink, Wallet } from "lucide-react";
import { formatUnits, type Address, type Hex } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { baseClient, basescanTx, ensureBaseSepolia, faucetAbi, injectedClient, NACRE_TEST_USDC } from "@/lib/nacre-chain";

const display = (amount: bigint) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(formatUnits(amount, 6)));

export function TestUsdcFaucet({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [claimed, setClaimed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);

  useEffect(() => {
    if (!account) return;
    let active = true;
    void Promise.all([
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: faucetAbi, functionName: "balanceOf", args: [account as Address] }),
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: faucetAbi, functionName: "claimed", args: [account as Address] }),
    ]).then(([tokens, didClaim]) => {
      if (active) { setBalance(tokens); setClaimed(didClaim); }
    }).catch(() => { if (active) setError("Could not read the faucet on Base Sepolia."); });
    return () => { active = false; };
  }, [account, hash]);

  async function claim() {
    if (!account || busy) return;
    setBusy(true); setError("");
    try {
      await ensureBaseSepolia();
      const wallet = injectedClient();
      const tx = await wallet.writeContract({ chain: wallet.chain, account: account as Address,
        address: NACRE_TEST_USDC, abi: faucetAbi, functionName: "claim" });
      setHash(tx);
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The faucet transaction reverted.");
      setClaimed(true);
      setBalance(await baseClient.readContract({ address: NACRE_TEST_USDC, abi: faucetAbi,
        functionName: "balanceOf", args: [account as Address] }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Faucet claim failed."); }
    finally { setBusy(false); }
  }

  return <div className="nf-page">
    <div className="nf-intro"><span className="nf-icon"><Coins size={25} /></span><div><Badge variant="outline">BASE SEPOLIA · TEST TOKEN</Badge><h2>Get 10,000 nUSDC</h2><p>Claim once per wallet to explore Nacre’s test pool and coverage flows. nUSDC is a demo token with no real dollar value.</p></div></div>
    <div className="nf-grid"><Card className="kd-card nf-primary"><div className="kd-card-heading"><h3><Wallet size={17} /> Your faucet</h3><span>ONE CLAIM PER ADDRESS</span></div><div className="nf-inner">
      <div className="nf-token"><span className="nf-token-mark">$</span><div><strong>Nacre Test USDC</strong><small>nUSDC · 6 decimals</small></div><strong>10,000</strong></div>
      <div className="nf-balance"><span>Your Base Sepolia balance</span><strong>{!account ? "Connect wallet" : balance === null ? "Loading…" : `${display(balance)} nUSDC`}</strong></div>
      {error && <p className="nf-error" role="alert">{error}</p>}
      {hash && <a className="nf-tx" href={basescanTx(hash)} target="_blank" rel="noreferrer">View transaction on BaseScan <ExternalLink size={14} /></a>}
      {!account ? <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={16} /></Button>
        : <Button className="kd-apply-button" disabled={claimed || busy} onClick={() => void claim()}>{busy ? "Claiming and confirming…" : claimed ? <><CheckCircle2 size={16} /> Already claimed</> : "Claim 10,000 nUSDC"}</Button>}
    </div></Card><Card className="kd-card nf-guide"><div className="kd-card-heading"><h3><CircleHelp size={17} /> Use the test tokens</h3><span>DEMO FLOW</span></div><div className="nf-inner"><ol><li><strong>Claim nUSDC</strong><span>Pay only Base Sepolia network gas.</span></li><li><strong>Model a position</strong><span>Choose nUSDC size and a WETH price range in a pool.</span></li><li><strong>Review the backing</strong><span>Underwriters compare modeled payouts and set a proposed premium.</span></li></ol><Link href="/dashboard/pools">Explore pools <ArrowRight size={15} /></Link></div></Card></div>
    <p className="nf-contract">Test token contract: <a href={`https://sepolia.basescan.org/address/${NACRE_TEST_USDC}`} target="_blank" rel="noreferrer">{NACRE_TEST_USDC} <ExternalLink size={12} /></a></p>
  </div>;
}
