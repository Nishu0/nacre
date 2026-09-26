# Recording: supply, SwapVM and fee protection

## What the video demonstrates

Base Sepolia transactions create the new pool, fund the underwriter's bid, swap
nUSDC to nWETH, mint an LP position and activate 30 day coverage. The final chapter
uses a **separate illustrative Base Sepolia settlement** with actual test-token
transfers and BaseScan receipts. Its 8.60 fee figure is synthetic; it does not
settle the real 30 day LP policy.

## Wallets and parameters

Use two browser wallets. Wallet A creates/funds the bid; wallet B supplies and buys
coverage. Keep some Base Sepolia ETH for gas in both. Wallet A needs at least 100
nUSDC; wallet B needs at least 1,010 nUSDC for the suggested 1,000 position plus
premium and swap buffer. Faucet tokens have no dollar redemption in this demo.

| Setting | Value |
| --- | --- |
| Pair | Existing nWETH / nUSDC |
| New pool trading fee | 0.3% (fee 3000), unused when checked |
| Starting pool price | 2689.50 nUSDC per nWETH |
| Bid range | ±10% preset; accept snapped tick boundaries |
| Coverage capital | 100 nUSDC |
| Maximum payout per position | 10 nUSDC |
| Simultaneous spots | 10 |
| Coverage duration | 30 days |
| Premium percentage | 18% of the protected fee cap |
| LP position amount | 1,000 USD equivalent |
| LP protected fee target | 10 nUSDC |
| LP payment option | nUSDC only · swap included |

Turn off automatic terms and enter the manual settings above. A brand-new pool
has no observed trading history for automatic pricing. These are chosen demo
terms, not a statistically supported premium recommendation.

Premium = ceil(fee cap × 18%, to six token decimals). A 10 cap costs 1.80;
a 20 cap costs 3.60 if the bid's per-position limit, backing and contract valuation
support it. Increasing the cap alone cannot bypass those limits. Rate is not APY.
The LP's selected fee cap must actually be 10 to show a 1.80 premium; expand
Coverage settings and set Minimum fee target if needed. Check the confirmation.

## Recording order

1. Open https://nacre.lol/dashboard/pools with wallet A and the Underwriter role.
   Create nWETH/nUSDC at 2689.50 with the unused 0.3% fee tier. Pool identities are
   unique: recreating an initialized pair/fee/hook combination is not possible.
2. Open the newly created pool. Use ±10%, disable automatic terms and fund the
   bid using the values above. Record the wallet transaction and the resulting
   10 free spots. The bid's owner must be wallet A. No deployer bid is seeded.
3. Switch to wallet B and the LP role. Open this same new pool and select wallet
   A's bid. Keep the full bid range for this recording. Enter 1000, select
   nUSDC only, and verify fee target 10, premium 1.80, and 30 days.
4. Record the confirmation breakdown: nWETH bought by SwapVM, remaining nUSDC
   for liquidity, 1.80 premium, swap buffer and maximum wallet debit. Approve
   nUSDC, then confirm Supply & protect. Unused tokens are refunded.
5. Show wallet B's portfolio and active policy with premium paid 1.80. The
   position row should link to its policy. Use BaseScan for the real checkout.
6. Switch to wallet A. Show 9/10 free spots, 10 reserved cover and 1.80 premium
   received. With one purchase and no other activity, available capital is
   100 - 10 + 1.80 = 91.80. Those values belong to the actual bid contract.
7. Introduce the final segment as a separate illustrative payout. Follow
   [the testnet demo steps](testnet-illustrative-settlement.md) in Portfolio.
   Wallet A deploys and funds 10 additional nUSDC; wallet B pays an additional
   1.80 premium. These are separate from the LP policy created earlier.
8. Publish the scenario using the wallet button. Show the real 1.40 payout,
   8.60 collateral return and 0.40 underwriter net with the BaseScan receipt.
   Switch accounts in the same browser to show both portfolio demo panels.

## Outcome explanation

The disclosed calculation is 10 target minus 8.60 synthetic fees = 1.40 payout.
The contract transfers actual test tokens. The underwriter receives 1.80 premium
and pays 1.40, leaving 0.40 before gas. The investor's actual demo payout is 0.40
less than their premium. Do not present the synthetic fees as actual LP earnings
or add this demo payout to the existing policy's settlement records.

The SwapVM maker inventory is independent of underwriter collateral and expires
within one day. Refresh the quote before recording. If it has expired, the
project deployment operator must renew/fund it; a frontend refresh cannot renew
an expired on-chain order. The snapshot checked before this release had about
0.8242 nWETH available, enough for the suggested one-position recording.
