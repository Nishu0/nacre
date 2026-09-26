"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ExternalLink, Wallet } from "lucide-react";
import TokenUSDC from "@web3icons/react/icons/tokens/TokenUSDC";
import TokenETH from "@web3icons/react/icons/tokens/TokenETH";
import { formatUnits, type Address, type Hex } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { baseClient, basescanTx, ensureBaseSepolia, faucetAbi, injectedClient,
  NACRE_REPEAT_FAUCET, NACRE_TEST_USDC, repeatFaucetAbi } from "@/lib/nacre-chain";
import { NACRE_TEST_WETH } from "@/lib/test-pools";

const assets = [
  { token: NACRE_TEST_USDC, faucet: NACRE_REPEAT_FAUCET, symbol: "nUSDC", name: "Nacre Test USDC", decimals: 6, claim: "10,000", Icon: TokenUSDC },
  { token: NACRE_TEST_WETH, faucet: NACRE_TEST_WETH, symbol: "nWETH", name: "Nacre Test WETH", decimals: 18, claim: "1", Icon: TokenETH },
] as const;
type Asset = typeof assets[number];

function FaucetCard({ asset, account, onConnect }: { asset: Asset; account: string | null; onConnect: () => Promise<void> }) {
  const [balance, setBalance] = useState<{ account: string; value: bigint } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const locked = useRef(false);
  useEffect(() => {
    if (!account) return;
    let active = true;
    void baseClient.readContract({ address: asset.token, abi: faucetAbi,
      functionName: "balanceOf", args: [account as Address] })
      .then((value) => { if (active) { setBalance({ account, value }); setError(""); } })
      .catch(() => { if (active) setError(`Could not read your ${asset.symbol} balance.`); });
    return () => { active = false; };
  }, [account, asset]);

  async function claim() {
    if (!account || locked.current) return;
    locked.current = true; setBusy(true); setError(""); setHash(null); setConfirmed(false);
    try {
      await ensureBaseSepolia();
      const wallet = injectedClient();
      const call = { account: account as Address, address: asset.faucet, abi: repeatFaucetAbi, functionName: "claim" as const };
      const estimated = await baseClient.estimateContractGas(call);
      if (estimated > BigInt(500_000)) throw new Error("Unexpected faucet gas estimate. Please retry.");
      const gas = estimated * BigInt(130) / BigInt(100) + BigInt(10_000);
      const tx = await wallet.writeContract({ ...call, chain: wallet.chain, gas });
      setHash(tx);
      const receipt = await baseClient.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
      if (receipt.status !== "success") throw new Error("The faucet transaction reverted.");
      setConfirmed(true);
      setBalance({ account, value: await baseClient.readContract({ address: asset.token, abi: faucetAbi,
        functionName: "balanceOf", args: [account as Address], blockNumber: receipt.blockNumber }) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Faucet claim failed."); }
    finally { locked.current = false; setBusy(false); }
  }
  const shown = balance?.account.toLowerCase() === account?.toLowerCase() ? balance : null;
  return <Card className="kd-card nf-primary"><div className="kd-card-heading"><h3><Wallet size={17} /> {asset.symbol} faucet</h3><a className="nf-contract-link" href={`https://sepolia.basescan.org/address/${asset.token}`} target="_blank" rel="noreferrer" aria-label={`View ${asset.symbol} contract`}>Contract <ExternalLink size={13} /></a></div><div className="nf-inner">
    <div className="nf-token"><span className="nf-token-mark" aria-hidden="true"><asset.Icon variant="mono" /></span><div><strong>{asset.name}</strong><small>{asset.symbol} · {asset.decimals} decimals</small></div><strong>{asset.claim}</strong></div>
    <div className="nf-balance"><span>Your Base Sepolia balance</span><strong>{!account ? "Connect wallet" : !shown ? "Loading…" : `${Number(formatUnits(shown.value, asset.decimals)).toLocaleString("en-US", { maximumFractionDigits: 5 })} ${asset.symbol}`}</strong></div>
    {error && <p className="nf-error" role="alert">{error}</p>}
    {confirmed && <p className="nf-success" role="status">{asset.claim} {asset.symbol} claimed. You can claim again whenever you need more.</p>}
    {hash && <a className="nf-tx" href={basescanTx(hash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={14} /></a>}
    {!account ? <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet <ArrowRight size={16} /></Button>
      : <Button className="kd-apply-button" disabled={busy} onClick={() => void claim()}>{busy ? "Claiming and confirming…" : `Claim ${asset.claim} ${asset.symbol}`}</Button>}
  </div></Card>;
}

export function TestUsdcFaucet({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  return <div className="nf-page">
    <div className="nf-intro"><span className="nf-icon"><span className="nf-token-mark"><TokenUSDC variant="mono" /></span></span><div><Badge variant="outline">BASE SEPOLIA · TEST TOKENS</Badge><h2>Get tokens for your next position</h2><p>Claim 10,000 nUSDC and 1 nWETH as often as you need. No ETH deposit is required; your wallet only pays network gas.</p></div></div>
    <div className="nf-grid">{assets.map((asset) => <FaucetCard key={`${asset.token}:${account ?? "disconnected"}`} asset={asset} account={account} onConnect={onConnect} />)}</div>
    <Card className="kd-card nf-guide"><div className="nf-inner"><p>Use both tokens in the <strong>nWETH / nUSDC</strong> pool. nWETH is our freely minted test asset, not ETH-backed WETH, and cannot be redeemed for ETH. Both tokens have no real monetary value.</p><Link href="/dashboard/pools">Open the pool directory <ArrowRight size={15} /></Link></div></Card>
  </div>;
}
