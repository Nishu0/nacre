# Atomic supply and fee protection

The local frontend uses `NacreAtomicCheckout` on Base Sepolia. It preserves the existing vault, Aqua app, pools and funded offers; the website is not automatically deployed by the contract deployment script.

## Purchase

1. Review range, coverage duration, payout cap and maximum premium.
2. Approve the checkout for the exact nWETH maximum and nUSDC deposit maximum plus premium. These approvals can require separate wallet confirmations.
3. Call `supplyAndProtect` once. The contract creates a per-purchase beneficiary account, mints the LP NFT, escrows it, reserves an eligible bid and buys coverage. Any failure reverts all those actions; gas can still be charged.

The checkout only accepts bids from its immutable factory, checks the buyer is not the underwriter, restricts the range, and enforces the premium maximum and transaction deadline. The fixed liquidity amount and token maxima enforce the reviewed mint budget. Excess token amounts and unused premium budget return to the buyer.

## Ownership and settlement

The vault holds the NFT while coverage is active. Its on-chain LP address is the per-purchase account. The trusted checkout's `beneficiaries(account)` mapping identifies the actual buying wallet; the backend resolves this mapping for policies and portfolio ownership. The verified checkout event proves position registration. Deposit accounting counts account-to-PoolManager transfers, excluding premium and refunds.

Anyone may settle an expired policy through the existing vault. When the vault returns the NFT, the checkout account forwards both fee currencies, any payout and the NFT to its beneficiary. A contract-wallet beneficiary that cannot receive NFTs may call `setSettlementRecipient` on its account to select its own recovery recipient. No third party or administrator can select that recipient.

Pending transaction hash and review data persist locally per wallet, pool, network and checkout address. Reloaded checkouts check that receipt before allowing another submission. Success is shown only when a verified `SuppliedAndProtected` event matches the buyer and selected bid.

## Verification

Run from `contract/`: `forge test --match-contract NacreAtomicCheckoutForkTest -vv` with `BASE_SEPOLIA_RPC_URL` supplied through the existing environment. Tests fork real Base Sepolia protocol state at block 47344900. The fee-earning settlement test retains the feed's real price and mocks its timestamp after advancing time, because a frozen fork cannot receive later oracle rounds.

Run the backend receipt/registration tests and frontend TypeScript/lint checks before releasing. `server/src/deploy-atomic-checkout.ts` performs a dry run by default; `--broadcast` deploys on Base Sepolia and saves a resumable pending hash before confirmation. It never migrates funds or replaces offers. Future checkout deployments must retain beneficiary resolution for old checkout accounts.
