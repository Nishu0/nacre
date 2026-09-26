import type { CoverageSnapshot } from "./coverage-contracts";

export function shortfallTotal(data: CoverageSnapshot, account: string, role: "lp" | "underwriter"): bigint | null {
  const owner = account.toLowerCase();
  const offers = new Set(data.offers.filter((offer) => offer.owner.toLowerCase() === owner).map((offer) => offer.address.toLowerCase()));
  const settled = data.requests.filter((request) => request.status === 3 && (role === "lp"
    ? request.lp.toLowerCase() === owner : offers.has(request.underwriter.toLowerCase())));
  // A missing receipt is unknown, never a zero payout or the policy's cap.
  if (settled.some((request) => !request.settlement)) return null;
  return settled.reduce((total, request) => total + BigInt(request.settlement!.payout), 0n);
}
