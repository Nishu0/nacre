# Nacre

**A floor beneath your fee income.**

Nacre is a market for protecting the fee income of a specific concentrated-liquidity position. A Uniswap v4 liquidity provider (LP) chooses a position, a coverage window, and a minimum amount of fees. Independent underwriters compete to price that promise through 1inch Aqua. The LP pays one premium; the selected underwriter locks enough collateral to make the maximum payout. At expiry, the position's eligible fees determine whether the LP receives a payout.

The product protects a **fee floor**, not the value of the LP's deposited assets. It does not claim to eliminate impermanent loss, guarantee a profit, or pay merely because the market price leaves the range.

The contract prototype implements this **position coverage** flow. The dashboard also models a conditional new-asset launch: it enables an admin-controlled Uniswap v4 pool initializer once recorded LP interest and protection capacity reach their targets. Those funding records are offchain simulations; the resulting Base Sepolia pool is real.

## The problem

Concentrated liquidity can earn more fees by putting capital inside a narrower price range. The same concentration makes fee income unpredictable: trading volume can fall, price can move beyond the selected ticks, or the position can spend a period outside the active range. An LP can still own the position while its expected fee income disappears.

Existing hedges usually refer to token price or portfolio value. Nacre refers to the income stream the LP actually wants to protect. The insured object is one verifiable Uniswap position over one defined time window, with a payout based on the difference between observed eligible fees and the agreed floor.

## The promise

A coverage request fixes these terms before underwriters quote:

| Term | Meaning |
| --- | --- |
| Position | Uniswap v4 pool, position token ID, tick range, and covered liquidity |
| Window | Start and expiry timestamps |
| Fee floor | Minimum eligible fee income, denominated in the settlement token |
| Payout cap | Maximum amount the underwriter can owe |
| Fee valuation | Pre-agreed treatment of both pool tokens and the reference price source |
| Premium | Price paid by the LP for the cover |
| Settlement token | Asset used for premium, collateral, and payout; USDC in the example |

At settlement:

```text
shortfall = max(feeFloor - eligibleFees, 0)
payout    = min(shortfall, payoutCap)
```

For example, an LP buys a seven-day **$1,000 fee floor** with a **$500 payout cap** and pays a **$24 premium**. If eligible fees are $600, the underwriter pays $400. If fees are $1,100, the payout is zero. If fees are only $300, the payout is capped at $500. The cap and premium are visible together so “protected” never implies an unlimited guarantee.

## Who participates

- **LP:** selects a v4 position and coverage terms, compares executable quotes, pays the premium, and receives any settlement payout.
- **Underwriter:** publishes a capacity-limited Aqua quote, receives the premium when selected, and escrows the quoted maximum payout.
- **Settlement caller:** finalizes an expired policy using verifiable position fees and the agreed valuation rule. Anyone can call settlement; a small, bounded reward from the premium can compensate the caller for gas.

Underwriters compete on **the same request**: identical position, window, fee floor, payout cap, and settlement rules. This makes premium comparison meaningful. Capacity, quote expiry, collateral availability, and executable size remain visible alongside price. The best quote is the lowest valid premium for the requested cover, not simply a percentage shown without matching terms.

## Architecture

```text
Uniswap v4 PositionManager / PoolManager
                 │ position identity, liquidity, fee state
                 ▼
        Position custody + fee ledger ──────► Settlement adapter
                 │                                  │
                 │ coverage request                 │ eligible fees
                 ▼                                  ▼
       Nacre request registry ────────────► Policy + collateral vault
                 ▲                                  ▲
                 │ accepted terms                   │ locked USDC / premium
                 │                                  │
      1inch Aqua + Nacre Aqua app ── future SwapVM quote checks
                 ▲
          Underwriter strategies
                 │
          Dashboard / quote UI
```

### Uniswap v4: the covered position and fee evidence

The [v4 PositionManager](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/mint-position) represents a liquidity position as an ERC-721 token. Nacre binds the policy to its pool, ticks, liquidity, token ID, and owner. A position custody adapter holds or otherwise restricts the covered position for the policy window. This prevents a position transfer, liquidity decrease, or range change from silently altering the insured risk after a quote is accepted.

A fee ledger records fees claimed during the window as well as fees still accrued at expiry. Claiming fees early must not make the measured income look smaller. The ledger excludes deposits, withdrawn principal, external rewards, and any fee income earned outside the covered window. If a policy allows a partial position, its covered liquidity and attribution rule are fixed up front.

Uniswap pools can generate fees in both constituent tokens. Nacre's policy names an explicit conversion rule to express those fees in the settlement token. A time-weighted or otherwise manipulation-resistant reference price at the specified observation time is used for the non-settlement token, with freshness and deviation bounds. The settlement adapter computes eligible fees from onchain position accounting and this precommitted rule; it does not accept a user-entered fee number.

The position can continue operating as normal inside its original Uniswap pool. The coverage contract does not need to change the pool's swap pricing or promise to keep the LP in range. [Uniswap v4's overview](https://developers.uniswap.org/docs/protocols/v4/overview) describes the pool and extension model that the integration builds upon.

### 1inch Aqua: competing underwriter inventory

[Aqua](https://github.com/1inch/aqua) tracks virtual balances for maker strategies while the underlying tokens remain in maker wallets until execution. Nacre uses this for **unfilled** cover offers: an underwriter can advertise capacity across quotes without pre-funding every offer separately. A quote binds the maker, request hash, premium, maximum payout, size, expiry, and nonce.

The Nacre Aqua app validates the offer against the exact LP request. The current prototype uses maker-authorized Aqua `ship` and `pull`, with no SwapVM program or separate signature. A future [SwapVM](https://github.com/1inch/swap-vm) instruction could enforce a more complex premium curve or risk-band limit. The maker's pricing inputs may reflect the pool, range width, window length, recent fee yield, and market regime. Once accepted, the quote's terms are fixed in the policy; a later offchain model update cannot rewrite them.

**Acceptance is the collateralization boundary.** In the same transaction that consumes the accepted offer, the maker's maximum payout is moved into the policy vault and the LP's premium is transferred according to the quote. If the maker lacks spendable funds, the quote cannot fill. Aqua's shared virtual balance improves quote availability before a fill; collateral backing a live policy is exclusive and cannot also back another payout.

### Policy and collateral vault

Each policy stores immutable economic terms and moves through:

```text
Requested → Quoted → Active → Settled
                    ↘ Expired / cancelled before fill
```

The vault holds the settlement token for the full payout cap. At expiry, settlement computes the shortfall, pays the LP up to the cap, and releases unused collateral to the underwriter. A policy settles once. The current contracts check Aqua strategy identity, token transfers, reentrancy, timestamps, and position ownership. An unavailable or stale reference price reverts settlement; a production fallback or timeout rule remains to be designed.

## Regime-aware underwriting

The most useful underwriting signal is not volatility alone. In a steady, active market, trading fees may be likely to exceed the floor even when prices move. In a directional break or low-volume period, fee income can deteriorate sharply. Underwriters can therefore quote different premiums or coverage capacities using:

- realized and recent fee yield for the position's pool and range;
- time spent near the range edge or outside it;
- directional trend, jump risk, and volatility;
- expected volume, liquidity depth, and remaining window length;
- their own outstanding payout exposure.

These signals inform **quote prices**. They do not change the LP's signed floor, cap, or settlement formula after purchase. A model or AI agent may recommend a quote, but final terms, collateral, and payout remain deterministic and inspectable.

## User journey

1. The LP opens the dashboard and selects a v4 position.
2. Nacre shows the current fee history, range, and a proposed fee floor.
3. The LP chooses a window and payout cap, creating one standardized request.
4. Underwriters return signed Aqua-backed quotes for that request.
5. The LP compares premium, cap, capacity, expiry, and underwriter collateral, then accepts one quote.
6. Premium and maximum payout collateral move atomically; the policy becomes active.
7. During the window, the dashboard shows eligible fees against the protected floor.
8. At expiry, anyone can trigger settlement. The LP receives any capped shortfall and the underwriter recovers the unused collateral.

The [local dashboard](http://localhost:3000/dashboard) reads the Bun research API. Its [Pools](http://localhost:3000/dashboard/pools) directory distinguishes deployed testnet pools from undeployed proposals. Pool details show the live Hyperliquid ETH perpetual reference graph, the on-chain Uniswap v4 pool price, an adjustable LP range, verified liquidity positions, and a separate underwriter risk calculator. LPs can preview a minimum fee target over 7, 14, 30, 60, or 90 days; the maximum request is 90% of the best historical window for the selected duration. The preview premium comes from six months of pool-level base APY observations. It is not an executable quote for the LP's chosen ticks. The graph subscribes to public ETH trades at `wss://api.hyperliquid.xyz/ws`, coalesces updates every 250 ms, and reconnects automatically. Initial history comes from Hyperliquid one-minute candles; HTTP refresh is a fallback when trades stop arriving. No API key is required. The reference is the ETH perpetual trade price quoted in USDC, not a separate USDC/USD oracle or the Uniswap execution price. These API prices are research inputs and are **not** read by an on-chain settlement contract.

The fixed Base Sepolia pair is WETH / **nUSDC**, a Nacre test token. The [faucet](http://localhost:3000/dashboard/faucet) now issues 10,000 nUSDC per request and allows repeated claims from the same wallet. A repeat-claim helper uses a fresh one-use caller for each request, keeping the original deployed token and initialized pool intact. The Uniswap v4 pool was initialized through the designated admin launcher. LPs can wrap Base Sepolia ETH, approve WETH and nUSDC through Permit2, and mint a PositionManager liquidity position. The server verifies the transaction receipt and records the position token ID in [Portfolio](http://localhost:3000/dashboard/portfolio). This is Uniswap's position receipt, not an extra Nacre NFT.

Overview and pool cards count verified Base Sepolia position mints. Underwriters can now fund exact tick ranges, choose 7–90 days, and set a premium as a percentage of each payout cap. LPs choose a funded range, mint a position, request a capped fee target, and buy a matching offer. The corrected vault escrows the LP NFT and the full payout cap. Portfolio and underwriting overview read actual offer balances, reserved caps and premiums from the chain. Owners can close an offer and withdraw unused funds; active caps are returned or paid at settlement. Unfilled LP requests can return their NFTs after their one-hour quote deadline. No sandbox records count toward these totals. The [contract README](contract/README.md#funded-range-coverage-september-26-update) lists the new verified contracts, full flow tests and remaining expiry-accounting limitation. No SwapVM swap is active in the dashboard flow.

Research pages cover the [fee backtest](http://localhost:3000/dashboard/backtest), [reference data](http://localhost:3000/dashboard/references), [launch steps](http://localhost:3000/dashboard/launch), and [premium model](http://localhost:3000/dashboard/pricing). The fee reference snapshot spans 180 days for three high-volume Ethereum Uniswap v3 pools; fee charts show the latest 90 days.

## Economic boundaries

- **Basis risk:** a fee floor covers measured fee income. It does not reimburse losses versus holding the assets, gas costs, price slippage, or all LP opportunity cost.
- **Payout certainty:** every active policy is fully collateralized for its cap in the settlement token.
- **Quote fairness:** offers can be ranked only when they cover identical economic terms and measurement rules.
- **Oracle safety:** fee conversion uses a fixed policy rule with stale-price and manipulation checks.
- **Position integrity:** changes that would invalidate the covered risk are blocked or require a new policy.
- **Capital efficiency:** Aqua can share maker inventory across unfilled strategies; funded policies have segregated collateral.

## Project links

- [Nacre landing page](http://localhost:3000/) and [dashboard](http://localhost:3000/dashboard) when running locally
- [Uniswap v4 developer overview](https://developers.uniswap.org/docs/protocols/v4/overview)
- [Uniswap v4 PositionManager guide](https://developers.uniswap.org/docs/protocols/v4/guides/managing-liquidity/mint-position)
- [1inch Aqua source and architecture](https://github.com/1inch/aqua)
- [1inch SwapVM source](https://github.com/1inch/swap-vm)
- [ETHGlobal Tokyo Uniswap Foundation prize](https://ethglobal.com/events/tokyo2026/prizes#uniswap-foundation)
- [ETHGlobal Tokyo 1inch prize](https://ethglobal.com/events/tokyo2026/prizes/1inch)

## Workspace

| Folder | Purpose |
| --- | --- |
| [frontend](frontend/) | Next.js landing page and dashboard |
| [server](server/) | Bun and Fastify API |
| [contract](contract/) | Foundry Solidity workspace |

## Run locally

```bash
# Terminal 1, from the repository root
cd server && bun install && bun run dev

# Terminal 2, from the repository root
cd frontend && bun install && bun run dev
```

Open [http://localhost:3000/dashboard](http://localhost:3000/dashboard). The API serves at [http://127.0.0.1:3001/health](http://127.0.0.1:3001/health) and seeds its checked-in snapshot into local SQLite on first start. The dashboard works without a wallet. For a remote backend, set `NACRE_API_URL` in the frontend environment to its server-side base URL. Solidity checks run from `contract/` with `forge build && forge test --offline`.

The server provides a local SQLite-backed [three-pool fee-yield backtest](server/README.md). Its historical Uniswap v3 pool-level figures are research estimates, not actual earnings for a specified Uniswap v4 position. The [contract README](contract/README.md) describes the custom v4 hook, Aqua underwriting app, escrow flow, deployment requirements, and prototype limitations.
