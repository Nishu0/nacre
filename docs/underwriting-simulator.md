# Fee backtest underwriting simulator

The Fee backtest page combines the existing Hyperliquid ETH perpetual WebSocket
chart with a browser-side coverage scenario calculator. All reference pairs are
WETH pairs. The live perpetual price is a market reference, not the initialized
Base Sepolia pool price. Stablecoin/USD parity is assumed.

## Inputs and evidence

The research API now returns `yieldHistory`: all 180 dated DefiLlama base APY
observations, independent of the existing last-90-day chart. Each chosen 7, 14,
30, 60 or 90-day window must contain consecutive days. Changing the historical
pair updates the history. LP deposit size inside the simulator is independent
of the capital used by the existing historical fee chart.

The latest dated reference APY is shown explicitly. It is neither a live yield
quote nor the realized yield of a specific NFT. Fees are approximated using
principal × APY / 100 / 365. Narrower bins receive no invented yield multiplier.
Tick bounds use the deployed WETH18/nUSDC6 orientation with tick spacing 10,
regardless of the historical reference pool's own fee tier/tick spacing.

## Scenarios and price bounds

The initial ±10% range follows live ETH until edited or centered. Then absolute
bounds remain fixed. Bin count and simulated eligibility use rounded ticks.
A user-selected terminal price change defines a linear price path. At each daily
midpoint, estimated fees are zero outside the range and receive a 20% haircut
inside the range. This is a hypothetical stress path applied to historical fee
yields, not historical tick replay. It misses intraday excursions.

User-selected stress weight mixes baseline and stressed shortfalls. The default
25% is an assumption, not an empirical exit or claim probability. Overlapping
historical windows are not independent observations.

## Pricing and exposure

- Protected fee floor equals full payout cap; payout = max(0, cap − eligible fees).
- Premium = cap × selected premium percentage, rounded up to six decimals.
- Modeled minimum premium = weighted mean payout × 1.2 + cap × 1%.
- LP premium ceiling = min(recent-window fees, latest-rate fees) × LP fee budget.
- Research cap ceiling = 90% of the highest observed same-duration fee window.
- Indicative contract ceiling = input principal × 20% × duration / 365.
  The real contract uses conservative oracle-valued NFT endpoint inventory;
  its limit can be lower. The input-based figure does not authorize a purchase.
- Position count = min(floor(capital / cap), floor(loss budget / (cap − premium)),
  user maximum). If premium equals cap, only capital and user maximum constrain
  this calculation. It still must satisfy LP feasibility separately.
- All positions reserve their full cap. Premiums never increase available
  collateral in this plan. Same-bin losses are fully correlated in the worst
  case; loss budget caps aggregate cap-minus-premium loss assuming slots sell.

Outputs assume every planned position sells once for one term, before gas.
There is no implied annualized underwriter return. Unsold capacity earns zero
premium. The plan does not transfer funds, save an offer, or enforce its position
limit on-chain: users must fund only the displayed reserved amount and confirm
actual pool parameters in Pools.

The coverage pays fee shortfalls, not principal or impermanent loss. Actual
settlement timing can affect collected eligible fees. The UI reports when no
premium interval satisfies both sides instead of claiming guaranteed profit.

## Checks

`bun test src/underwriting-simulator.test.ts` from `server` covers correlated
loss budgets, collateral limits, position limits, price-range sensitivity,
duration/window coverage, missing dates, infeasible terms, invalid numbers, and
180-day evidence versus the 90-day chart display.
