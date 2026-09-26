import type { CoverageOffer } from "./coverage-contracts";

export function availableBid(offer: CoverageOffer, tick: number, investor?: string | null, cap = 1n) {
  return !offer.closed && BigInt(offer.available) >= cap && cap > 0n
    && tick >= offer.tickLower && tick < offer.tickUpper
    && (!investor || offer.owner.toLowerCase() !== investor.toLowerCase());
}

export function bidMatchesPosition(offer: CoverageOffer, position: { poolId: string; tickLower: number; tickUpper: number }) {
  return offer.poolId.toLowerCase() === position.poolId.toLowerCase()
    && offer.tickLower === position.tickLower && offer.tickUpper === position.tickUpper;
}
