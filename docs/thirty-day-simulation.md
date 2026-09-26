# Thirty day fee protection simulation

Run from the repository root:

```sh
bun server/scripts/simulate-thirty-days.ts
```

Requires the existing contract dependencies, server Bun dependencies, Forge and
Anvil. The script builds the fixtures, starts its own temporary Anvil on an
available localhost port, executes the scenario, saves receipts and stops its
node. It uses unlocked local dummy accounts. It does not load private keys,
modify app configuration, use Base Sepolia, or touch live position #28556.

## Show results in the local dashboard

```sh
NACRE_DEMO=1 bun server/scripts/simulate-thirty-days.ts
```

This explicit per-run variable publishes `.deploy/thirty-day-simulation/dashboard.json`
after the settlement assertions pass. The LP and underwriter overview/portfolio
pages poll it every two seconds through `/api/demo-settlement`. The demo panel is
clearly labeled, works without a wallet, and does not replace live wallet totals.
While a new run is pending or fails, it does not present old payouts as newly
confirmed. Successful runs replace the snapshot atomically.

The script prints a `http://localhost:3000/api/demo-settlement?tx=0x...` receipt
link. Dashboard links open the same saved local receipt, premium transaction or
full report. Production requires the explicit `NACRE_DEMO=1` server setting and a read-only
artifact directory at `NACRE_DEMO_DIR`. The recording deployment enables this
setting. Run with `NACRE_DEMO_PUBLISH=1` to copy verified artifacts to nacre.lol.
See `docs/recording-walkthrough.md` for the complete sequence.

Hide the panel without deleting receipts or changing live data:

```sh
bun server/scripts/simulate-thirty-days.ts --hide-demo
```

Running without `NACRE_DEMO=1` leaves the last published dashboard snapshot alone.

Outputs are overwritten on each successful run:

* `.deploy/thirty-day-simulation/report.html`: chart, daily table, settlement math
  and the actual local transaction hashes.
* `.deploy/thirty-day-simulation/daily.csv`: 30 daily observations and accrual hashes.
* `.deploy/thirty-day-simulation/receipts.json`: all transaction receipts, addresses,
  assumptions, transfer logs and totals. Big integers are serialized as strings.

## Scenario and accounting

The price path in the script has exactly three outside days, days 12 through 14.
Prices are converted to ticks using the nWETH18/nUSDC6 convention. Tick range is
lower inclusive and upper exclusive: `[-198410, -196400)`.

Each price represents an entire day. There is no intraday simulation. Default
modeled income is 0.32 dummy USDC on 26 in-range days, 0.28 on the last day and
zero outside the range. All fees are in the settlement token.

`DEMO_FEE_CAP=10`, `DEMO_PREMIUM=1.8` and `DEMO_PAYOUT=1.4` are the default
scenario variables. These deliberately control the mocked fee accrual; they do
not predict market outcomes. Collected fees are 26 × 0.32 + 0.28 = 8.60.
The actual vault computes `min(max(feeFloor - eligibleFees, 0), payoutCap)`.
It pays 1.40 at expiry and returns 8.60 unused collateral.

The three outside days account for 0.96 of the shortfall. With all 30 days earning,
this modeled volume would yield 9.56, already below the target by 0.44. Outside
time does not independently entitle the investor to payment.

Investor income after premium is 8.60 + 1.40 - 1.80 = 8.20. Underwriter income
before gas is 1.80 - 1.40 = 0.40, so their 100 becomes 100.40. This is a chosen
profitable underwriting scenario, not guaranteed profit. The investor would
have earned 8.60 without buying protection in this particular scenario.

## What is real in the demo

The existing NacrePolicyVault, NacreFeeHook, NacreAquaUnderwriter and official Aqua
contracts run unchanged on the local EVM. Token transfers, escrow, purchase,
expiry enforcement, fee recording, shortfall payout and NFT return execute as
transactions with receipts. A direct Aqua underwriter quote is used; this demo
does not exercise limited-offer slots or SwapVM supply.

The demo tokens, position NFT/manager, pool state, fee accrual and oracle are
explicit mocks in `contract/test/demo/ThirtyDayMocks.sol`. There are no real
Uniswap swaps and no real $1,000 LP principal. The mocked NFT only exercises
policy custody and fee collection. These fixtures must never be deployed as
production protocol components.

Day 14 settlement is simulated and must revert with TooEarly. At day 30 a single
settlement transaction collects fees, pays the investor from reserved collateral,
returns unused collateral to the underwriter and returns the NFT. The
underwriter need not sign a separate payment at expiry. Local hashes are not
BaseScan links and the temporary chain disappears when the script finishes.

The runner asserts the on-chain Settled event, exact investor/underwriter balance
deltas, NFT return, exactly three outside days, early settlement rejection and
zero collateral remaining reserved. Assertions must all pass before a new report
is written. Change the `prices`, `dailyFee`, `floor`, `cap` and `premium` constants
in the script for other scenarios, adjusting scenario assertions/report copy too.
