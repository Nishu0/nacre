"use client";

import { formatUnits, parseUnits } from "viem";
import { Dialog } from "radix-ui";
import { Check, ExternalLink, LoaderCircle, X } from "lucide-react";
import { basescanTx } from "@/lib/nacre-chain";

import type { SupplyReview } from "@/lib/supply-review";
export type { SupplyReview } from "@/lib/supply-review";
export type SupplyPhase = "review" | "approval" | "supply" | "done";

export function SupplyConfirmation({ open, onOpenChange, review, phase, busy, message, error, hash, saved, onConfirm, onRegister }: {
  open: boolean; onOpenChange: (open: boolean) => void; review: SupplyReview | null;
  phase: SupplyPhase; busy: boolean; message: string; error: string; hash: string | null;
  saved: boolean; onConfirm: () => void; onRegister: () => void;
}) {
  const done = phase === "done";
  const number = (value: number, digits = 2) => value.toLocaleString("en-US", { maximumFractionDigits: digits });
  const premium = review?.premiumUnits != null ? BigInt(review.premiumUnits) : null;
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="supply-overlay" />
      <Dialog.Content className="supply-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
        <Dialog.Close className="supply-close" disabled={busy} aria-label="Close supply confirmation"><X size={20} /></Dialog.Close>
        <Dialog.Title className="supply-title">{done ? "Supplied & protected" : "Confirm supply & protection"}</Dialog.Title>
        <Dialog.Description className="supply-description">{done ? "Your LP position and fee protection are active on Base Sepolia." : "Review your deposit and premium."}</Dialog.Description>
        <ol className="supply-steps" aria-label="Supply progress">
          {["Approve tokens", "Supply & protect"].map((label, index) => {
            const complete = done || (index === 0 && phase === "supply");
            const current = !done && (index === 0 ? phase !== "supply" : phase === "supply");
            return <li key={label} className={complete ? "is-complete" : current ? "is-current" : ""} aria-current={current ? "step" : undefined}>
              <span className="supply-step-icon">{complete ? <Check size={18} /> : current && busy ? <LoaderCircle size={18} className="supply-spinner" /> : index + 1}</span>
              <span><small>Step {index + 1}{complete ? " · Complete" : ""}</small><strong>{label}</strong></span>
            </li>;
          })}
        </ol>
        {review && <div className="supply-review">
          {review.singleToken && <div><span>Pay with</span><strong>nUSDC only</strong></div>}
          <div><span>{review.symbol}{review.singleToken ? " · bought by SwapVM" : ""}</span><strong>{number(review.wethAmount, 8)}</strong></div>
          <div><span>nUSDC</span><strong>{number(review.usdcAmount, 6)}</strong></div>
          <div><span>Position value</span><strong>≈ ${number(review.total)}</strong></div>
          <div><span>Price range</span><strong>${number(review.lower)} – ${number(review.upper)}</strong></div>
          {review.durationDays && <div><span>Coverage duration</span><strong>{review.durationDays} days</strong></div>}
          {!done && <>
            {review.feeCap && <div><span>Protected fee cap</span><strong>{formatUnits(BigInt(review.feeCap), 6)} nUSDC</strong></div>}
            <div><span>Premium{review.premiumBps !== undefined ? ` · ${number(review.premiumBps / 100)}% of cap` : ""}</span><strong>{premium === null ? "Unavailable" : `${formatUnits(premium, 6)} nUSDC`}</strong></div>
            {review.singleToken && <>
              <div><span>Swap payment · quoted</span><strong>{formatUnits(BigInt(review.singleToken.amountIn), 6)} nUSDC</strong></div>
              <div><span>Swap buffer · maximum 0.5%</span><strong>{formatUnits(BigInt(review.singleToken.maxInput) - BigInt(review.singleToken.amountIn), 6)} nUSDC</strong></div>
              <div><span>Maximum total · deposit, swap & premium</span><strong>{premium === null ? "Unavailable" : formatUnits(parseUnits(review.usdcAmount.toFixed(6), 6) + premium + BigInt(review.singleToken.maxInput), 6)} nUSDC</strong></div>
            </>}
            {!review.singleToken && <><div><span>Total · before gas</span><strong>{premium === null ? "—" : `≈ $${number(review.total + Number(formatUnits(premium, 6)), 6)}`}</strong></div>
            <div><span>nUSDC total · deposit + premium</span><strong>{premium === null ? "—" : formatUnits(parseUnits(review.usdcAmount.toFixed(6), 6) + premium, 6)}</strong></div></>}
          </>}
        </div>}
        {review?.singleToken && !done && <p className="supply-description">Swap, supply and protection complete together. Unspent tokens return to your wallet. Gas is paid separately in ETH.</p>}
        <div aria-live="polite" role="status" className="supply-status">{message}</div>
        {error && <p className="supply-error" role="alert">{done ? `Supply confirmed. Portfolio update needs a retry: ${error}` : error}</p>}
        {hash && <a className="supply-primary" href={basescanTx(hash)} target="_blank" rel="noreferrer">{done ? "Supplied & protected" : "View transaction"} · {hash.slice(0, 8)}…{hash.slice(-6)} <ExternalLink size={16} /></a>}
        {!done && <button type="button" className="supply-primary" disabled={busy} onClick={onConfirm}>{busy ? <><LoaderCircle size={16} className="supply-spinner" /> {phase === "approval" ? "Approving tokens…" : "Waiting for confirmation…"}</> : hash ? "Check transaction status" : error ? "Try again" : "Confirm supply & protect"}</button>}
        {done && !saved && <button type="button" className="supply-secondary" disabled={busy} onClick={onRegister}>{busy ? "Updating portfolio…" : "Retry portfolio update"}</button>}
        {done && <Dialog.Close className="supply-secondary" disabled={busy}>Done</Dialog.Close>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
