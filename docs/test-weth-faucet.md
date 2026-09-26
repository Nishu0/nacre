# Repeatable nWETH faucet — Base Sepolia

## Deployment

- Test token: `0x3333C20E21Eeaed85766232B20641d56fd3788c4`
- Pool launcher: `0x55AB9D22a516DD6D03571A68398b38eD9c867821`
- Coverage factory: `0x815bAcd48995FC5AbE143bC08aFcB40c7306f3B7`
- Pool ID: `0x743bf18c39cc3c9a033ca8dd020a49609e82c25243bc005f5bb5520e4a5748ae`
- Pool initialization transaction: `0xa2c7dc0ad1b587520c31a27f1d5b2d030a459d329a47f9fbd0c15c6e5a6c914c`
- Local market: `e909c168-0291-412e-a3f8-949743621b82`

All three contracts are verified on BaseScan. The token has 18 decimals and
`claim()` mints exactly 1e18 units to the caller every time. No deposit, cooldown,
or per-wallet claim limit applies. There is no ETH withdrawal or redemption.
Only Base Sepolia gas requires native ETH. This is an unbacked test asset.

The new pool uses the existing nUSDC, Nacre hook, coverage vault and Aqua app.
The existing fee-value oracle now maps nWETH to the same ETH/USD feed as WETH
for **test policy valuation**, not as a claim of redeemable economic backing.
A distinct range-offer factory binds underwriting offers to the new pool.
Both tokens and all policy amounts remain testnet assets.

## Existing users

The original canonical WETH/nUSDC pool, position #28545, and original coverage
factory are retained. Each pool selects its own token and underwriting factory.
Pool pages request coverage snapshots scoped to their pool. Portfolios aggregate
both pools but match offers by pool ID as well as bins and duration. WETH and
nWETH mint amounts are shown separately in account totals.

The new launcher initializes its immutable pool in its constructor and emits
`PoolLaunched`. The registration API checks the known launcher, admin and pool
ID, and registers this already initialized pool without creating fake funding.
Future funding and LP positions are still actual user transactions.

## Verification

The fork test `testDeployedTestWethFaucetMintAndCoverage` uses the actual deployed
nWETH token, initialized pool, coverage factory, vault, app, oracle and Uniswap
PositionManager. It claims, mints without depositing ETH, funds an offer, buys
coverage with a distinct LP wallet, then settles and returns the NFT.

Run from `contract`:

```
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org forge test --match-test testDeployedTestWethFaucetMintAndCoverage -vv
forge test --match-contract NacreTestWETHTest
```

`script/NacreTestWETH.s.sol` records how this deployment was created. Re-running
it deploys a new generation, not an update to these immutable contracts.
