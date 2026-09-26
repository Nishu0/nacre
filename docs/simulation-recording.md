# Simulation page

Open https://nacre.lol/dashboard/simulation. The Simulation item is in the
Research navigation. Switch LP and Underwriter to show each side's metrics.

From the project root, run:

```sh
NACRE_DEMO=1 NACRE_DEMO_PUBLISH=1 DEMO_FEE_CAP=10 DEMO_PREMIUM=1.8 DEMO_PAYOUT=1.4 bun server/scripts/simulate-thirty-days.ts
```

The script creates an isolated local Anvil chain, runs the thirty-day scenario,
verifies its transactions and transfers, then publishes the report and receipts
to the Simulation page. No wallet signature or private key is required. Publishing
uses the existing SSH key. The page refreshes within about two seconds of publication.

LP results: 8.60 simulated fees, 1.40 shortfall received, 1.80 premium paid,
8.20 net fee income. Underwriter results: 1.80 premium, 1.40 shortfall paid,
8.60 collateral returned and 0.40 net result before gas.

These are simulated values. Receipts belong to local Anvil, chain ID 31337;
they are not BaseScan transactions. The Base Sepolia policy and actual portfolio
balances do not change when this script runs.

To reset the page to its initial zero display before another recording:

```sh
bun server/scripts/simulate-thirty-days.ts --hide-demo
bun server/scripts/publish-demo.ts
```
