"use client";

import { Dialog } from "radix-ui";
import { Check, ExternalLink, LoaderCircle, X } from "lucide-react";
import { basescanTx } from "@/lib/nacre-chain";

export type SupplyReview = {
  account: string; marketId: string; poolId: string; token: `0x${string}`;
  symbol: string; fee: number; lower: number; upper: number;
  wethAmount: number; usdcAmount: number; total: number;
};
export type SupplyPhase = "review" | "approval" | "supply" | "done";

export function SupplyConfirmation({ open, onOpenChange, review, phase, busy, message, error, hash, saved, onConfirm, onRegister }: {
  open: boolean; onOpenChange: (open: boolean) => void; review: SupplyReview | null;
  phase: SupplyPhase; busy: boolean; message: string; error: string; hash: string | null;
  saved: boolean; onConfirm: () => void; onRegister: () => void;
}) {
  const done = phase === "done";
  const number = (value: number, digits = 2) => value.toLocaleString("en-US", { maximumFractionDigits: digits });
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!busy) onOpenChange(value); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="supply-overlay" />
      <Dialog.Content className="supply-dialog" onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }} onPointerDownOutside={(event) => event.preventDefault()}>
        <Dialog.Close className="supply-close" disabled={busy} aria-label="Close supply confirmation"><X size={20} /></Dialog.Close>
        <Dialog.Title className="supply-title">{done ? "Supplied" : "Confirm supply"}</Dialog.Title>
        <Dialog.Description className="supply-description">{done ? "Your liquidity position is confirmed on Base Sepolia." : "Review your tokens, then confirm the transactions in your wallet."}</Dialog.Description>
        <ol className="supply-steps" aria-label="Supply progress">
          {["Approve tokens", "Supply"].map((label, index) => {
            const complete = done || (index === 0 && phase === "supply");
            const current = !done && (index === 0 ? phase !== "supply" : phase === "supply");
            return <li key={label} className={complete ? "is-complete" : current ? "is-current" : ""} aria-current={current ? "step" : undefined}>
              <span className="supply-step-icon">{complete ? <Check size={18} /> : current && busy ? <LoaderCircle size={18} className="supply-spinner" /> : index + 1}</span>
              <span><small>Step {index + 1}{complete ? " · Complete" : ""}</small><strong>{label}</strong></span>
            </li>;
          })}
        </ol>
        {review && <div className="supply-review">
          <div><span>{review.symbol}</span><strong>{number(review.wethAmount, 8)}</strong></div>
          <div><span>nUSDC</span><strong>{number(review.usdcAmount, 6)}</strong></div>
          <div><span>Position value</span><strong>≈ ${number(review.total)}</strong></div>
          <div><span>Price range</span><strong>${number(review.lower)} – ${number(review.upper)}</strong></div>
        </div>}
        {!done && <p className="supply-description">Token amounts are maximums; unused tokens stay in your wallet. Approval may require several wallet confirmations. Network gas is paid separately.</p>}
        <div aria-live="polite" role="status" className="supply-status">{message}</div>
        {error && <p className="supply-error" role="alert">{done ? `Supply confirmed. Portfolio update needs a retry: ${error}` : error}</p>}
        {hash && <a className="supply-primary" href={basescanTx(hash)} target="_blank" rel="noreferrer">{done ? "Supplied" : "View transaction"} · {hash.slice(0, 8)}…{hash.slice(-6)} <ExternalLink size={16} /></a>}
        {!done && <button type="button" className="supply-primary" disabled={busy} onClick={onConfirm}>{busy ? <><LoaderCircle size={16} className="supply-spinner" /> {phase === "approval" ? "Approving tokens…" : "Waiting for confirmation…"}</> : hash ? "Check transaction status" : error ? "Try again" : "Confirm supply"}</button>}
        {done && !saved && <button type="button" className="supply-secondary" disabled={busy} onClick={onRegister}>{busy ? "Updating portfolio…" : "Retry portfolio update"}</button>}
        {done && <Dialog.Close className="supply-secondary" disabled={busy}>Done</Dialog.Close>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
