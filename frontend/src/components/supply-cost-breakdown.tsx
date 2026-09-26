import { formatUnits, parseUnits } from "viem";

export function SupplyCostBreakdown({ positionValue, usdcAmount, premiumUnits, feeCapUnits, balance }: {
  positionValue: number; usdcAmount: number; premiumUnits: string | null; feeCapUnits?: string; balance?: bigint | null;
}) {
  const premium = premiumUnits === null ? null : BigInt(premiumUnits);
  const totalUsdc = premium === null ? null : parseUnits(usdcAmount.toFixed(6), 6) + premium;
  const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  return <section className="supply-review" aria-label="Supply and protection costs" aria-live="polite">
    <div><span>LP deposit · paid on supply</span><strong>≈ ${number(positionValue)}</strong></div>
    <div><span>Protection premium · included</span><strong>{premium === null ? "Calculating…" : `${formatUnits(premium, 6)} nUSDC`}</strong></div>
    {feeCapUnits && <div><span>Maximum coverage payout</span><strong>{formatUnits(BigInt(feeCapUnits), 6)} nUSDC</strong></div>}
    <div><span>Total with protection · before gas</span><strong>{premium === null ? "—" : `≈ $${number(positionValue + Number(formatUnits(premium, 6)))}`}</strong></div>
    <div><span>nUSDC needed · deposit + premium</span><strong>{totalUsdc === null ? "—" : formatUnits(totalUsdc, 6)}</strong></div>
    <p className="supply-description">Supply creates your LP position and buys protection in the same transaction. This premium is your maximum charge; if the bid cannot fill within it, the whole transaction reverts. Gas is separate.</p>
    {totalUsdc !== null && balance != null && balance < totalUsdc && <p className="supply-error" role="status">You need {formatUnits(totalUsdc - balance, 6)} more nUSDC to complete both supply and protection.</p>}
  </section>;
}
