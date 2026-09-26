"use client";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { baseClient, erc20Abi, NACRE_TEST_USDC } from "@/lib/nacre-chain";
import { NACRE_TEST_WETH } from "@/lib/test-pools";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useCoverage } from "@/lib/use-coverage";
import { shortfallTotal } from "@/lib/shortfall";
import { useDemoSettlement } from "@/components/demo-settlement";

export function WorkspaceBalances({ account, onConnect, role = "lp" }: { account: string | null; onConnect: () => Promise<void>; role?: "lp" | "underwriter" }) {
  const { data: coverage, error: coverageError, refresh: refreshCoverage } = useCoverage();
  const { demo, error: demoError } = useDemoSettlement();
  const [data, setData] = useState<{ account: string; values: bigint[] } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!account) return;
    let active = true;
    const read = () => void Promise.all([
      baseClient.readContract({ address: NACRE_TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }),
      baseClient.readContract({ address: NACRE_TEST_WETH, abi: erc20Abi, functionName: "balanceOf", args: [account as Address] }),
    ]).then((values) => { if (active) { setData({ account, values }); setError(""); } })
      .catch(() => { if (active) setError("Balances could not refresh. Please retry."); });
    read();
    const timer = setInterval(read, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [account, refresh]);
  const values = data?.account === account ? data.values : null;
  const shortfall = account && coverage && !coverageError ? shortfallTotal(coverage, account, role) : null;
  const confirmedShortfall = !account ? "0" : shortfall === null ? "—" : formatUnits(shortfall, 6);
  const simulationEnabled = demo?.enabled;
  const simulatedPayout = !demoError && demo?.status === "settled" ? demo.totals?.payout : undefined;
  return <div className="mw-page mw-wallet-balances">
    <div className="mw-stats">{["nUSDC BALANCE", "nWETH BALANCE"].map((label, index) => <Card className="kd-card" key={label}><div className="mw-stat"><span>{label}</span><strong>{!account ? "0" : error ? "—" : !values ? "…" : Number(formatUnits(values[index], index === 0 ? 6 : 18)).toLocaleString("en-US", { maximumFractionDigits: index === 0 ? 2 : 5 })}</strong><small>Wallet balance · Base Sepolia</small></div></Card>)}
      <Card className="kd-card"><div className="mw-stat">
        <span>{role === "lp" ? "SHORTFALL RECEIVED" : "SHORTFALL PAID"}{simulationEnabled ? " · SIMULATION" : ""}</span>
        <strong>{simulationEnabled ? simulatedPayout ?? "—" : confirmedShortfall}</strong>
        <small>{simulationEnabled ? "nUSDC · 30 day local simulation" : "nUSDC · confirmed policy payouts"}</small>
        {simulationEnabled && <>
          <small>Base Sepolia payouts: {confirmedShortfall} nUSDC</small>
          {simulatedPayout !== undefined && demo.settlementHash
            ? <a className="mw-evidence-link" href={`/api/demo-settlement?tx=${demo.settlementHash}`} target="_blank" rel="noreferrer">View simulation receipt</a>
            : <small role="status">{demoError ? "Simulation results could not refresh." : demo.status === "failed" ? "Simulation failed." : "Waiting for simulation settlement…"}</small>}
        </>}
      </div></Card>
    </div>
    {error && <p role="status">{error}</p>}
    {coverageError && account && <p role="status">Shortfall payments could not refresh. Please retry.</p>}
    {!account ? <Button className="kd-apply-button" onClick={() => void onConnect()}>Connect wallet</Button> : <Button variant="outline" onClick={() => { setRefresh((value) => value + 1); void refreshCoverage(); }}>Refresh balances</Button>}
  </div>;
}
