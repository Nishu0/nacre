# Nacre research API

Bun, Fastify, and **local SQLite** hold a reproducible three-pool research snapshot. No Docker database or AWS account is needed for this stage.

```bash
cd server
bun install
bun run db:seed
bun run dev
```

The checked-in `data/pool-history.json` contains 180 aligned daily observations from **2026-03-30 through 2026-09-25**. [DefiLlama Yields](https://yields.llama.fi/pools) supplies pool-level `apyBase` and TVL; [GeckoTerminal OHLCV](https://api.geckoterminal.com/docs/index.html) supplies each pool's daily USD trading volume. `bun run dev` seeds local `data/nacre.sqlite` on first start. `bun run db:seed` reloads it, and `bun run data:refresh` fetches the latest 180 complete UTC days. Neither AWS nor Docker is required.

These pools ranked among GeckoTerminal's highest 24-hour-volume Ethereum Uniswap v3 markets when the snapshot was refreshed. The last-90-day totals are **whole-pool** activity, not fees received by one LP:

| Pool | Last 90d volume | Gross fee proxy | Sources |
| --- | ---: | ---: | --- |
| USDC/WETH 0.01% | $3.67B | $366,934 | [Volume](https://www.geckoterminal.com/eth/pools/0xe0554a476a092703abdb3ef35c80e0d76d32939f) · [Yield](https://defillama.com/yields/pool/8b3ed515-5e6f-449a-9b64-25113cda7a29) |
| USDC/WETH 0.05% | $6.95B | $3.48M | [Volume](https://www.geckoterminal.com/eth/pools/0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640) · [Yield](https://defillama.com/yields/pool/665dc8bc-c79d-4800-97f7-304bf368e547) |
| WETH/USDT 0.30% | $2.79B | $8.37M | [Volume](https://www.geckoterminal.com/eth/pools/0x4e68ccd3e89f51c3074ca5072bbac773960dfa36) · [Yield](https://defillama.com/yields/pool/fc9f488e-8183-416f-a61e-4e5c571d4395) |

## API

- `GET /health`
- `GET /api/pools`
- `GET /api/pools/:poolId/backtest?principalUsd=100000`
- `GET /api/pools/:poolId/quotes?principalUsd=100000`
- `GET /api/live-prices` — fresh WETH/USD and USDC/USD oracle prices, with derived WETH/USDC, timestamps, and source
- `GET /api/live-price-history` — Pyth hourly benchmark samples and newly observed live prices for the pool chart
- `GET /api/markets` and `GET /api/markets/:marketId`
- `GET /api/markets/:marketId/price-history` — recorded manual sandbox price scenarios
- `GET /api/markets/:marketId/risk?depositUsd=1000` — underwriter research for an example position: six-month monthly fee evidence, overlapping 30-day shortfalls, fully backed payout cap, and current indicative quote
- `POST /api/markets/:marketId/oracle-sync` — re-read a fresh oracle quote on the server and move the sandbox tick
- `GET /api/portfolio?participant=...` — LP deposits for one local participant
- `GET /api/underwriting?participant=...` — underwriting pledges for one local participant

Market creation, LP deposits, underwriting pledges, coverage checks, and price moves are local SQLite sandbox actions. The pool chart uses [Pyth Benchmarks](https://docs.pyth.network/price-feeds/core/use-historical-price-data) hourly WETH/USD divided by USDC/USD, then appends fresh Pyth samples observed by this server. Run `bun run data:pyth-chart` with `PYTH_API_KEY` in the ignored `server/.env` to refresh its initial history. `GET /api/live-prices` prefers [Pyth Hermes](https://docs.pyth.network/price-feeds/core/fetch-price-updates); if Pyth is unavailable, it reads Ethereum-mainnet Chainlink feeds over the configured public RPC. Both sources are server-side reference data with publish-time checks. Oracle sync changes only the shared sandbox tick; the contracts do not consume these API prices for settlement. A pledge is recorded interest, not locked collateral; no premiums, payouts, or realized LP fees are produced by these routes.

For each day, gross pool fee proxy = `daily volume × nominal fee tier`; it is before any protocol share and may differ from indexed fee collections. Modeled LP fees = `principalUsd × apyBase / 100 / 365`. [DefiLlama's methodology](https://github.com/DefiLlama/yield-server#apy-methodology) provides context for `apyBase`. A 30-day window sums 30 consecutive daily estimates. The API returns recent, best, worst, and all 151 overlapping windows, plus the last 90 daily volume, gross-fee, TVL, and modeled-LP observations. The dashboard charts the last 90 days but premiums can inspect the full 180-day sample. These numbers **are not actual fees earned by an individual LP**: no ticks, range uptime, changing capital share, gas, token P&L, or position-level fee accounting are modeled. These are v3 references, not v4 hook pools.

The indicative tiers place one fee floor at the latest 30-day run rate and, if higher, a stretch floor at 98% of the observed best 30-day window. The payout cap equals the floor, so the quote models a full fee minimum even if eligible fees are zero. The LP's minimum *net* fee income is the floor minus the upfront premium, before gas or token P&L. The premium heuristic blends 75% of historical capped shortfalls with 25% of shortfalls after a 20% fee haircut, then adds a 20% risk margin and a 1% cap-based capital charge. Because the windows overlap and do not represent position-level earnings, this is **not** an actuarial fair premium. Actual underwriters set executable prices.

`bun run check` and `bun test` verify the service. A true concentrated-liquidity backtest needs historical mint, burn, collect, and swap events for a specific position and an archive RPC or indexer. AWS can help with that later, but is unnecessary for this local prototype.
