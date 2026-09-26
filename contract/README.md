# Nacre contracts

This Foundry workspace implements the original **position-specific fee floor** for a *new Uniswap v4 pool deployed with the Nacre hook*. It cannot retrofit an existing v3 pool. The three v3 pools in the server are historical pricing references.

## Flow

1. An LP escrows a v4 PositionManager NFT and creates a fixed request: fee floor, payout cap, window, and quote deadline.
2. Underwriters approve USDC to Aqua, then ship `abi.encode(NacreAquaUnderwriter.Quote)` to the **official Aqua registry** with a virtual balance of at least the payout cap. Shipping creates a strategy hash; it does not transfer USDC. A maker can withdraw an unfilled offer with `Aqua.dock`.
3. The LP compares shipped quotes for the same request and accepts one. `canFill` checks the current virtual balance, actual wallet balance, allowance, deadline, and request status for display. The transaction rechecks them: Aqua transfers the full payout cap from the underwriter's wallet to the vault, the LP pays the premium, and pre-policy fees are collected and returned before coverage starts. The winning request closes to other quotes.
4. The vault holds the NFT for the window. The hook rejects liquidity changes to the covered position and records fees collected by the PositionManager.
5. At expiry, anyone can call `settle`. A zero-liquidity decrease collects accrued fees; the hook ledger must equal the tokens received. A configured price oracle values both fee tokens in USDC units. The vault pays `min(max(floor - eligibleFees, 0), cap)`, returns unused collateral and the NFT.

`src/NacreFeeHook.sol` implements v4 `IHooks` and requires a CREATE2 address with before/after add/remove liquidity permission bits. `script/NacreDeploy.s.sol` mines that address. `src/NacreAquaUnderwriter.sol` calls the official Aqua registry; the integration test deploys the official Aqua contract. SwapVM is not yet integrated.

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

For deployment, configure `NacreChainlinkFeeOracle` with one-time USD feed bindings. Set `POOL_MANAGER`, `POSITION_MANAGER`, `SETTLEMENT_TOKEN` (six-decimal USDC), `FEE_VALUE_ORACLE`, `AQUA`, and `DEPLOYER` (the broadcasting address) before running `script/NacreDeploy.s.sol` with your chosen RPC and deployer.

## Safety boundaries

- An active policy is backed by the payout cap actually held in the vault. An Aqua virtual balance alone is insufficient. `canFill` is a point-in-time preview, since the maker can withdraw tokens, revoke approval, or dock before the LP submits a transaction.
- The NFT is held by the vault, and the hook blocks changes to its liquidity during cover.
- Only ERC-20/ERC-20 pools are accepted. Native ETH pools are outside this transfer path.
- Price feeds must be fresh. There is no fallback settlement if a feed is unavailable.
- **Expiry accounting is not production-complete:** if nobody settles promptly, fees earned after `endAt` enter the collection. A reliable expiry snapshot or time-bounded keeper process is required before real value is used.
- The backtest models pool-level yield, while the contract settles the actual covered position's fees. Suggested premiums are research estimates, not binding quotes.
- The contracts have not undergone a security audit or mainnet fork test.
