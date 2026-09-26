# Nacre contracts

This Foundry workspace implements the original **position-specific fee floor** for a *new Uniswap v4 pool deployed with the Nacre hook*. It cannot retrofit an existing v3 pool. The three v3 pools in the server are historical pricing references.

## Flow

1. An LP escrows a v4 PositionManager NFT and creates a fixed request: fee floor, payout cap, window, and quote deadline.
2. Underwriters approve USDC to Aqua, then ship `abi.encode(NacreAquaUnderwriter.Quote)` to the **official Aqua registry** with a virtual balance of at least the payout cap. Shipping creates a strategy hash; it does not transfer USDC. A maker can withdraw an unfilled offer with `Aqua.dock`.
3. The LP compares shipped quotes for the same request and accepts one. `canFill` checks the current virtual balance, actual wallet balance, allowance, deadline, and request status for display. The transaction rechecks them: Aqua transfers the full payout cap from the underwriter's wallet to the vault, the LP pays the premium, and pre-policy fees are collected and returned before coverage starts. The winning request closes to other quotes.
4. The vault holds the NFT for the window. The hook rejects liquidity changes to the covered position and records fees collected by the PositionManager.
5. At expiry, anyone can call `settle`. A zero-liquidity decrease collects accrued fees; the hook ledger must equal the tokens received. A configured price oracle values both fee tokens in USDC units. The vault pays `min(max(floor - eligibleFees, 0), cap)`, returns unused collateral and the NFT.

`src/NacreFeeHook.sol` implements v4 `IHooks` and requires a CREATE2 address with before/after add/remove liquidity permission bits. `script/NacreDeploy.s.sol` mines and deploys that address through the canonical CREATE2 deployer. `src/NacreAquaUnderwriter.sol` calls Aqua; the integration test deploys the official Aqua contract. New coverage is rejected if the v4 PoolManager tick is outside the NFT's `[tickLower, tickUpper)` range. SwapVM is not yet integrated.

## Aqua source references

- [Aqua0's custom SwapVM router](https://github.com/Aqua0-fi/aqua0-ethglobal/blob/main/packages/contracts/src/routers/AquaForexSwapVMRouter.sol) and [ForexCurve instruction](https://github.com/Aqua0-fi/aqua0-ethglobal/blob/main/packages/contracts/src/instructions/ForexCurve.sol) show how a maker's shipped balances can feed a custom pricing curve.
- [Agora's quote builder](https://github.com/0xbri3t/Agora/blob/main/blockend/src/aqua/AgoraQuoteBuilder.sol) and [end-to-end Aqua test](https://github.com/0xbri3t/Agora/blob/main/blockend/test/aqua/AquaLimitE2E.t.sol) demonstrate matching the `ship` strategy hash, docking an unfilled offer, and checking real token transfers on fill.
- [Aqua Outcome Market's maker hook](https://github.com/yielddev/AquaOutcomeMarket/blob/main/src/hooks/MakerMintingHook.sol) demonstrates collateral prepared just before a SwapVM transfer.

Nacre's current insurance fill has one settlement token and an all-or-nothing payout cap, so the prototype uses a direct Aqua app. The test covers the equivalent lifecycle: ship, quote competition, fill, dock, expired quote, missing wallet backing, and rollback when premium payment fails. No reference code was copied into Nacre.

## Run

```bash
cd contract
bash scripts/install-deps.sh
forge build
forge test --offline
```

Dependencies install into ignored `lib/` directories at revisions recorded in the script. Solidity uses Cancun EVM features and compiler 0.8.30. The full flow test uses official Aqua with a mock v4 pool and PositionManager, rather than a live chain fork.

## Base Sepolia deployment

Copy `.env.example` to `.env` inside `contract/`, set its mode to `600`, and fill `ETHERSCAN_API_KEY`, `PRIVATE_KEY`, `DEPLOYER`, and a checked `WETH_USD_FEED`. The `.env` file and Foundry broadcast data are gitignored. Use a dedicated testnet-only deployer; never put the private key in a command, commit, issue, or frontend variable.

The sample addresses are Uniswap v4's Base Sepolia PoolManager and PositionManager, Nacre's six-decimal test nUSDC, and Base's WETH predeploy. Confirm their deployed code and feed freshness before broadcasting. The deploy script checks chain ID 84532, that the private key matches `DEPLOYER`, and that the account has test ETH:

```bash
cd contract
./scripts/deploy-base-sepolia.sh
```

If `AQUA` is unset, the script deploys the pinned Aqua dependency on Base Sepolia, because 1inch's public deployment list does not currently name that testnet. If `FEE_VALUE_ORACLE` is unset, it deploys a fresh oracle and binds the WETH/USD feed. It then deploys the permissioned hook, vault, and Aqua underwriting app, links them, and asks Foundry to verify the source. This script does not deploy SwapVM, initialize a pool, mint an LP position, or collect test nUSDC. The dashboard's funding records are a local sandbox and do not represent token transfers.

Verification can be retried without broadcasting another deployment: `./scripts/verify-base-sepolia.sh` reads the latest local broadcast, checks each contract's constructor arguments, and uses Aqua's own source remapping only for Aqua.

### Verified Base Sepolia deployment

The deployment from `0x9ACCF6E95219d489E86D5E61eBA44357538077aa` is verified on BaseScan:

| Contract | Address |
| --- | --- |
| Nacre v4 fee hook | [`0x253b…8f00`](https://sepolia.basescan.org/address/0x253b6089405104d480723ca7ab27021f81268f00#code) |
| Policy vault | [`0xb920…696a`](https://sepolia.basescan.org/address/0xb920ee1841c334b0979508d91b5ed1a8ff32696a#code) |
| Aqua underwriting app | [`0x917a…a0c5`](https://sepolia.basescan.org/address/0x917a35660eeb5f9c14ad30f18ee8cb4ae158a0c5#code) |
| Aqua registry | [`0x569c…15f3`](https://sepolia.basescan.org/address/0x569c255369093c80856eda8a49df834b7e9415f3#code) |
| Chainlink fee-value oracle | [`0x5a3b…e087`](https://sepolia.basescan.org/address/0x5a3b7b7dc08a57f6205497285ea2a8a7fbd6e087#code) |

The hook's `controller` is the vault, and the vault's `aquaApp` is the underwriting app; both links were checked by RPC after deployment. This original deployment used Circle's test USDC and is separate from the current nUSDC demo deployment below.

### Current nUSDC demo pool

The fixed WETH / nUSDC pool was initialized on Base Sepolia with the Nacre hook. The dashboard uses these deployments:

| Contract | Address |
| --- | --- |
| Nacre Test USDC faucet | [`0xfa35…AAC8`](https://sepolia.basescan.org/address/0xfa35D165b03B8eB193934D338Db8de536e84AAC8#code) |
| Repeatable nUSDC claim helper | [`0x2EB1…C425B`](https://sepolia.basescan.org/address/0x2EB148c4E526524E930a22788faa7e7c00eC425B#code) |
| Nacre v4 fee hook | [`0x4851…4f00`](https://sepolia.basescan.org/address/0x4851960CCcdb2c1d4Db6a91E65a09800C0664f00#code) |
| Policy vault | [`0x5Dc6…8FdA`](https://sepolia.basescan.org/address/0x5Dc6026219bbB88998A8BA61a4490001EC998FdA#code) |
| Aqua underwriting app | [`0xFCF4…DEFc`](https://sepolia.basescan.org/address/0xFCF408B807D8a188B6FEfD8666799F1C9684DEFc#code) |
| Aqua registry | [`0xb33a…8E28`](https://sepolia.basescan.org/address/0xb33a189b5BAb0A65Af9aceE0608CDEc47f7a8E28#code) |
| Chainlink fee-value oracle | [`0x5c7B…8504`](https://sepolia.basescan.org/address/0x5c7Bb75ae16bF790e73C8A92f3041EeF01778504#code) |
| Admin pool launcher | [`0x49Fc…05a6`](https://sepolia.basescan.org/address/0x49FcA731F70DaF38d828E34204F2437E75a605a6#code) |

The launcher has immutable admin `0xeC5660E8912DC26FC0e5eC700bf05b9f326D6288`. Its [confirmed launch transaction](https://sepolia.basescan.org/tx/0x01554e3f1760acafa7e53f0c0647d5e469ade26474bba4b67e7e883a4aae54a8) initialized pool ID `0xbd5de3746823c61672498c78534510c625648ad7db69af5a3777de02c9e5ba56`. PoolManager initialization itself is permissionless; the admin restriction applies to Nacre's launcher, while the dashboard's two-sided funding check is offchain. The original token still mints once per caller; `NacreRepeatFaucet` creates a fresh one-use caller on each request and forwards 10,000 nUSDC to the requesting wallet. This keeps the token used by the pool unchanged. A deployed pool starts empty; users must mint liquidity separately. No coverage policy is active.

## Safety boundaries

- An active policy is backed by the payout cap actually held in the vault. An Aqua virtual balance alone is insufficient. `canFill` is a point-in-time preview, since the maker can withdraw tokens, revoke approval, or dock before the LP submits a transaction.
- The NFT is held by the vault, and the hook blocks changes to its liquidity during cover.
- Only ERC-20/ERC-20 pools are accepted. Native ETH pools are outside this transfer path.
- Price feeds must be fresh. There is no fallback settlement if a feed is unavailable.
- **Expiry accounting is not production-complete:** if nobody settles promptly, fees earned after `endAt` enter the collection. A reliable expiry snapshot or time-bounded keeper process is required before real value is used.
- The backtest models pool-level yield, while the contract settles the actual covered position's fees. Suggested premiums are research estimates, not binding quotes.
- The contracts have not undergone a security audit or mainnet fork test.

### Funded range coverage (September 26 update)

The dashboard now uses a corrected policy vault and funded range-offer factory:

| Contract | Base Sepolia address |
| --- | --- |
| Corrected policy vault | [0x879e…cce0](https://sepolia.basescan.org/address/0x879ead283e76afc12865ca43a0a3f10c3626cce0#code) |
| Coverage Aqua app | [0x0d2e…17cd](https://sepolia.basescan.org/address/0x0d2ed632e5a10ab713d183369687720d4e3817cd#code) |
| Range-offer factory | [0x6b98…6751](https://sepolia.basescan.org/address/0x6b9803efd7f39163af2ceb330ee58afbadd06751#code) |

The existing WETH/nUSDC pool, tokens, hook, oracle and Aqua registry are unchanged.
The previous vault used action `0x0f` (TAKE_ALL), which the actual PositionManager
rejected. Fee collection now uses `0x11` (TAKE_PAIR). The new vault relies on NFT
custody for this existing pool because its hook's controller was already bound
to the previous vault. The LP cannot transfer, remove liquidity or collect while
the new vault owns its NFT. For newly bound hooks, the vault also checks hook
fee accounting. No existing policy or NFT was migrated.

An underwriter funds a separate `NacreRangeOffer` with exact lower/upper ticks,
a fixed duration, and a premium in basis points of each payout cap. LP requests
must match the ticks and duration exactly; the owner's own LP requests are
excluded. The payout cap must equal the fee floor and cannot exceed 20% annualized
of the position's conservative oracle-valued endpoint inventory, scaled to the
selected duration. Zero/dust positions cannot advertise a large claim against
funded capacity. An LP publishes the matching Aqua strategy and buys through the app.
The full cap moves into the policy vault atomically with premium payment. Shared
unfilled virtual quotes cannot create multiple claims on already reserved funds.

`closeAndWithdraw` revokes Aqua allowance and returns the offer's available
balance. Active caps stay in the policy vault. When policies settle, unused caps
return to the original offer and its owner can withdraw again. All premium and
portfolio totals are read from on-chain requests and offer balances.

Run `forge test --match-contract 'Nacre(RangeOffers|Flow)'` with
`BASE_SEPOLIA_RPC_URL` set to include the real deployed pool fork test. It mints
through the actual PositionManager, creates and buys seven-day cover, settles a
zero-fee claim after a local time warp, and returns the NFT. Tests also cover
positive fees, competing fills, insufficient capacity, wrong ticks/duration,
revocation, and owner-only withdrawals. The fork makes no testnet transactions.

The expiry-accounting limitation above still applies: settlement collects fees
at execution, so delayed settlement can include post-expiry fees. This remains
a test-token prototype, not an audited mainnet insurance deployment.
