"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

type Demo = {
  enabled: boolean;
  status?: "running" | "settled" | "failed";
  verifiedAt?: string;
  settlementHash?: string;
  purchaseHash?: string;
  totals?: { earned: string; payout: string; premium: string; underwriterRefund: string;
    investorFeesAfterPremium: string; underwriterNet: string; feeTarget: string };
};

export function useDemoSettlement() {
  const [demo, setDemo] = useState<Demo | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const response = await fetch("/api/demo-settlement", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Demo unavailable");
        const value: Demo = await response.json();
        if (!controller.signal.aborted) { setDemo(value); setError(false); }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), 2000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return { demo, error };
}

export function DemoSettlement({ role }: { role: "lp" | "underwriter" }) {
  const { demo, error } = useDemoSettlement();
  const waiting = !!demo && !demo.enabled && !error;
  const settled = !error && demo?.enabled && demo.status === "settled" && demo.totals;
  const totals = demo?.totals;
  const values = role === "lp" ? [
    ["TRADING FEES EARNED", totals?.earned], ["SHORTFALL RECEIVED", totals?.payout],
    ["PREMIUM PAID", totals?.premium], ["NET FEE INCOME", totals?.investorFeesAfterPremium],
  ] : [
    ["PREMIUM EARNED", totals?.premium], ["SHORTFALL PAID", totals?.payout],
    ["COLLATERAL RETURNED", totals?.underwriterRefund], ["NET UNDERWRITING RESULT", totals?.underwriterNet],
  ];
  return <section aria-label="30 day simulation results" className="mw-page">
    <Card className="kd-card mw-panel"><div className="kd-card-heading"><h2>30 day settlement demo</h2><span>LOCAL SIMULATION · NOT WALLET BALANCES</span></div>
      <div className="mw-trade-inner">
        <p>Dummy prices and fees on a separate local chain. Days 12–14 are outside the range. These amounts belong to the demo accounts.</p>
        {!settled && <p role="status">{error ? "Demo results unavailable. Retrying…" : waiting ? "Ready. Run the simulation script to update these values." : !demo ? "Loading simulation state…" : demo.status === "failed" ? "Simulation failed. No new settlement confirmed." : "Simulation running. Waiting for verified settlement…"}</p>}
        {(waiting || settled) && <>
          <div className="mw-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>{values.map(([label, value]) =>
            <div className="mw-stat" key={label}><span>{label}</span><strong>{waiting ? "0" : value}</strong><small>{waiting ? "Simulation not run" : "dummy USDC · day 30"}</small></div>)}</div>
        </>}
        {settled && <>
          <p>Fee target {totals?.feeTarget} − earned fees {totals?.earned} = <strong>{totals?.payout} shortfall paid</strong> from reserved collateral.</p>
          <p><a className="mw-evidence-link" href={`/api/demo-settlement?tx=${demo.settlementHash}`} target="_blank" rel="noreferrer">View settlement receipt · {demo.settlementHash?.slice(0, 10)}…{demo.settlementHash?.slice(-6)}</a></p>
          <p><a className="mw-evidence-link" href={`/api/demo-settlement?tx=${demo.purchaseHash}`} target="_blank" rel="noreferrer">View premium payment receipt</a> · <a className="mw-evidence-link" href="/api/demo-settlement?report=1" target="_blank" rel="noreferrer">Daily calculations and full report</a></p>
          <small>Verified {demo.verifiedAt ? new Date(demo.verifiedAt).toLocaleString() : ""}. Receipt links show saved Anvil transactions, not BaseScan.</small>
        </>}
      </div>
    </Card>
  </section>;
}
