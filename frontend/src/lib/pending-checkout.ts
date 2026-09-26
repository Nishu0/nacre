import type { SupplyReview } from "./supply-review";
import type { Hex } from "viem";
import { ATOMIC_CHECKOUT } from "./atomic-checkout";
const key = (account: string, poolId: string) => `nacre-checkout:84532:${ATOMIC_CHECKOUT.toLowerCase()}:${account.toLowerCase()}:${poolId.toLowerCase()}`;
export function savePendingCheckout(hash: Hex, review: SupplyReview) {
  try { localStorage.setItem(key(review.account, review.poolId), JSON.stringify({ hash, review })); } catch { /* In-memory receipt tracking remains active if browser storage is disabled. */ }
}
export function clearPendingCheckout(review: SupplyReview) {
  try { localStorage.removeItem(key(review.account, review.poolId)); } catch { /* Browser storage may be disabled. */ }
}
export function readPendingCheckout(account: string, poolId: string): { hash: Hex; review: SupplyReview } | null {
  try {
    const value = JSON.parse(localStorage.getItem(key(account, poolId)) ?? "null");
    if (!value || !/^0x[0-9a-f]{64}$/i.test(value.hash) || value.review?.account?.toLowerCase() !== account.toLowerCase()
      || value.review?.poolId?.toLowerCase() !== poolId.toLowerCase() || !/^0x[0-9a-f]{40}$/i.test(value.review.offer)) return null;
    return value;
  } catch { return null; }
}
