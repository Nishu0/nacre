# Nacre research API

Bun, Fastify, and **local SQLite** hold a reproducible three-pool research snapshot. No Docker database or AWS account is needed for this stage.

```bash
cd server
bun install
bun run db:seed
bun run dev
```

The checked-in `data/pool-history.json` contains daily [DefiLlama Yields API](https://yields.llama.fi/pools) `apyBase` and TVL observations for 2026-06-26 through 2026-09-25. `bun run db:seed` loads them into `data/nacre.sqlite` (ignored by Git). `bun run data:refresh` fetches the latest 92 full UTC days and replaces the snapshot and SQLite tables.

| Pool | Historical series |
| --- | --- |
| Ethereum Uniswap v3 USDC/WETH 0.05% | [DefiLlama](https://yields.llama.fi/chart/665dc8bc-c79d-4800-97f7-304bf368e547) |
| Ethereum Uniswap v3 WBTC/WETH 0.05% | [DefiLlama](https://yields.llama.fi/chart/d59a5728-d391-4989-86f6-a94e11e0eb3b) |
| Ethereum Uniswap v3 USDC/USDT 0.01% | [DefiLlama](https://yields.llama.fi/chart/e737d721-f45c-40f0-9793-9f56261862b9) |

## API

- `GET /health`
- `GET /api/pools`
- `GET /api/pools/:poolId/backtest?principalUsd=100000`
- `GET /api/pools/:poolId/quotes?principalUsd=100000`

For each day, modeled fees = `principalUsd × apyBase / 100 / 365`. [DefiLlama's methodology](https://github.com/DefiLlama/yield-server#apy-methodology) calls for fee-based APY over a 24-hour window. A 30-day window sums 30 consecutive daily estimates. Ninety-two days yield 63 *overlapping* windows. The API returns recent, best, worst, and every window. These numbers **are not actual fees earned by an individual LP**: no ticks, range uptime, changing capital share, gas, token P&L, or individual fee accounting are modeled. These are v3 reference pools, not v4 hook pools.

The indicative tiers place one fee floor at the latest 30-day run rate and, if higher, a stretch floor at 98% of the observed best 30-day window. The payout cap equals the floor, so the quote models a full fee minimum even if eligible fees are zero. The LP's minimum *net* fee income is the floor minus the upfront premium, before gas or token P&L. The premium heuristic blends 75% of historical capped shortfalls with 25% of shortfalls after a 20% fee haircut, then adds a 20% risk margin and a 1% cap-based capital charge. Because the windows overlap and cover only three months, this is **not** an actuarial fair premium. Actual underwriters set executable prices.

`bun run check` and `bun test` verify the service. A true concentrated-liquidity backtest needs historical mint, burn, collect, and swap events for a specific position and an archive RPC or indexer. AWS can help with that later, but is unnecessary for this local prototype.
