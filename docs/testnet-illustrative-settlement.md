# Base Sepolia illustrative settlement

This is a separate synthetic scenario with real test-token transfers. It does not
settle the existing 30 day LP policy or verify historical fee earnings.

In the same browser, open `/dashboard/portfolio` with underwriter
`0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288`. Deploy the demo, then fund it with
10 nUSDC. Switch to investor `0x5D94EbA53Fa695FA927DE595778109D297d90870` and
pay the separate 1.80 nUSDC premium. This is an additional payment, independent
of any premium already paid for an LP policy.

Click **Publish scenario & pay 1.40 nUSDC** with either wallet. The contract sends
1.40 nUSDC to the investor and returns 8.60 collateral to the underwriter.
Both portfolios show confirmed premium and payout with BaseScan links.
The underwriter's net is 0.40 before gas. The investor's actual premium less
payout is a cost of 0.40. The synthetic 8.60 fees are not real trading income.

The deployment is saved in this browser and origin. Switch accounts here to
show both portfolios. Localhost and nacre.lol have separate storage.

The contract commits to `frontend/public/illustrative-scenario.json` using
keccak256 of its compact JSON serialization. It records purchase and settlement
blocks for receipt lookup. No admin can withdraw collateral after purchase.

Verify from the project root with the deployment transaction hash:

```sh
bun server/scripts/settle-testnet-demo.ts DEPLOYMENT_TX_HASH
```

The script is read-only by default. For optional CLI settlement, set
`NACRE_DEMO_SIGNER_KEY` locally to one of the two specified wallets and append
`--broadcast`. Prefer the browser wallet button to avoid exporting a key.
Never send private keys in chat. The script never uses the project deployer key.
