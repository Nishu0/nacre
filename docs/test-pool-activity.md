# Limited bids and reproducible test activity

## Coverage bids

Every new bid uses `NacreLimitedOfferFactory`. A maker chooses price ticks, duration, capital, maximum fee payout per position, premium (% of that cap), and simultaneous spots. Maximum initial spots = min(100, floor(capital / cap)). Example: 100 nUSDC / 10 nUSDC = 10 spots. Choosing 3 limits concurrent policies to 3 even with extra capital.

- One spot is reserved by publishing a quote for an escrowed LP NFT; checkout lasts up to 15 minutes. The quote expires at the exact same boundary used for capacity accounting.
- Buying activates the policy and holds the spot until settlement. Unfilled reservations expire. A request can only activate with one maker.
- Makers can create up to four bids atomically, compete on identical bins, top up their own capital, add fully backed spots, and update future premiums. Already published premiums stay locked until expiry.
- Slots are per bid, not a monopoly across all makers at that range. Another maker can fund the same range independently.
- Existing v1 bids remain withdrawable and use their original capital-only limits. Deployed policies and wallet balances are preserved.

## Pricing guidance

Pool activity is measured from PoolManager Swap and ModifyLiquidity events. Gross fees are estimated from input amount × the actual swap fee. Inventory value is reconstructed from every liquidity modification since initialization, valued at current pool price. Accrued fees and protocol deductions are excluded. The annualized ratio uses the shorter of 24h and pool age; it is a run rate, not a promised return.

Generated swaps through `NacreTestSwapBatch` are identified by their on-chain sender and separated from other activity. They are excluded from pricing guidance by default. All assets are faucet tokens; remaining activity is not asserted to be economically organic.

Premium suggestions use historical Ethereum v3 0.05% rolling fee windows as a proxy. With at least 10 observed swaps and 1h of pool history (or explicit synthetic-demo opt-in), lower measured earnings scale those windows down. Price = mean capped shortfall × 1.2 + 1% of cap. The investor affordability guide allocates at most 20% of modeled fees to premium. If the required price exceeds that guide, the UI warns but allows manual terms up to the contract's 100%-of-cap premium limit. Actual NFT fee caps also retain the existing contract ceiling.

For a 1,000 nUSDC position and 6% annual fee rate, 30-day fees are approximately 4.93 nUSDC, not 60. A 10 nUSDC promise would require roughly 5.07 nUSDC in claims under that flat fee scenario. A small 8% premium (0.80) would not cover that claim. The UI shows this conflict instead of manufacturing a profitable quote.

## Generate test swaps

Run from repository root. The script uses `PRIVATE_KEY`, `DEPLOYER`, and `BASE_SEPOLIA_RPC_URL` from `contract/.env`. Never expose or commit that file.

```sh
# Preview. No transactions are sent without --broadcast.
bun --env-file=contract/.env server/src/run-pool-activity.ts --fee 10000 --swaps 10 --target-apr 6 --seed

# Execute bounded swaps on the existing 1% nWETH/nUSDC pool.
bun --env-file=contract/.env server/src/run-pool-activity.ts --fee 10000 --swaps 10 --target-apr 6 --seed --broadcast

# Another registered pool: set its fee tier, optionally assert its pool ID.
bun --env-file=contract/.env server/src/run-pool-activity.ts --fee 3000 --pool-id 0xYOUR_POOL_ID --swaps 10 --volume 2 --seed --broadcast
```

`--seed` mints a faucet-token LP only when the pool has no active liquidity. Default seed is 1,000 nUSDC equivalent, adjustable using `--seed-value` (100–5,000). The deployer owns that NFT. User balances and positions are untouched. An existing pool must be registered in the local API (port 3001).

Target volume is computed from the current observation window, TVL, existing fee estimate, and fee tier. It attempts to approach the target run rate once; it does not maintain it. The displayed rate naturally changes as the time window advances. `--volume` explicitly overrides target sizing. Batches have 2–20 alternating swaps, exact bounded approvals, minimum outputs, price limits, and a deadline. Total input volume is capped at 500 nUSDC equivalent and 5% of inventory value. Approvals and optional minting precede the atomic swap batch. The router supports only the configured test tokens, Nacre hook, spacing 10, and fees ≤1%.

Deployment metadata is in `frontend/src/lib/bid-tools-deployment.json`. The idempotent deployment helper skips addresses already containing code:

```sh
forge build --root contract
bun --env-file=contract/.env server/src/deploy-bid-tools.ts --broadcast
```

## Verification

```sh
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test --root contract --match-test 'testLimitedSpotsAtomicReservationsTopUpAndCompetingMakers|testBatchSwapsBoundedAndAtomic' -vv
bun test server/src/limited-bids.test.ts
bun run --cwd server check
bun run --cwd frontend tsc --noEmit
```

## Recorded Base Sepolia run

- Limited factory: `0xeaf7909e6a9cadeb3d406ea6954ee63a900fc5f5`
- Test swap helper: `0x9806e96a09bb4fbad3e76e7bb3378ae0cb152107`
- Pool: `0x03be77c419a9a391c642576e5468d32ba21250f59d750be76e1043efe50c5a16` (1%)
- Seed LP transaction: `0x389decba2fe32944c218cee7385677c0e9340e9f8c2042e54ef46df9164e48e3`
- [10-swap batch](https://sepolia.basescan.org/tx/0x7629b4609e5e41afcd22fe3c651decb7853d74312bd7c6f7e582c30b6e89072f)
- Inventory value before swaps: approximately 938.95 nUSDC.
- Generated gross fee estimate: 0.003826565 nUSDC over approximately 0.38266 nUSDC equivalent swap input volume.
- Sizing target: 6% annualized over the then-current 0.595-hour pool age. This is synthetic test activity, not a sustainable 6% return.
