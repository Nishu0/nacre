"use client";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { baseClient, erc20Abi, NACRE_TEST_USDC } from "@/lib/nacre-chain";
import { NACRE_TEST_WETH } from "@/lib/test-pools";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function WorkspaceBalances({ account, onConnect }: { account: string | null; onConnect: () => Promise<void> }) {
  const [data, setData] = useState<{ account: string; values: bigint[] } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!account) return;
    let active = true;
    const read = () => void Promise.all([
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }),
      baseClient.readContract({ address: NACRE_TEST_WETH, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }),
      baseClient.getBalance({ address: account as Address }),
    ]).then((values) => { if (active) { setData({ account, values }); setError(""); } })
      .catch(() => { if (active) setError("Balances could not refresh. Please retry."); });
    read();
    const timer = setInterval(read, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [account, refresh]);
  const values = data?.account === account ? data.values : null;
  return <div className="mw-page mw-wallet-balances">
    <div className="mw-stats">{["nUSDC BALANCE", "nWETH BALANCE", "ETH FOR GAS"].map((label, index) => <Card className="kd-card" key={label}><div className="mw-stat"><span>{label}</span><strong>{!account ? "0" : !values ? "…" : Number(formatUnits(values[index], index === 0 ? 6 : 18)).toLocaleString("en-US", { maximumFractionDigits: index === 0 ? 2 : 5 })}</strong><small>Wallet balance · Base Sepolia</small></div></Card>)}</div>
    {error && <p role="status">{error}</p>}
    {!account ? <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet</Button> : <Button variant="outline" onClick={() => setRefresh((value) => value + 1)}>Refresh balances</Button>}
  </div>;
}
