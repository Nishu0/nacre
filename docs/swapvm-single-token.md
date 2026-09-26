# Single token supply with SwapVM

## Implemented

The investor can choose **nUSDC only · swap included**. The existing position amount remains an LP target, not an all-inclusive wallet debit. The review displays the exact-output swap quote, nUSDC deposit, coverage premium, 0.5% maximum swap-input buffer and maximum nUSDC payment before gas. Any unused nUSDC and nWETH return to the beneficiary. ETH is still needed for gas.

`NacreSwapVMCheckout.supplyWithUSDC` pulls only nUSDC, calls the real SwapVM router to buy the required nWETH amount, creates a beneficiary account, mints the Uniswap position and buys coverage through Nacre Aqua. All steps revert together if any step fails. The original two-token checkout and existing policies are preserved. Both checkout event emitters are allowlisted for portfolio attribution.

The quote is bound to its order hash, recipient, maximum input, exact output and deadline. Router approval is limited and cleared after the swap. Refund accounting excludes preexisting checkout balances. The beneficiary account forwards settlement to the original buyer.

`NacreSwapVMMarket` holds separate maker-funded nWETH inventory. Its owner publishes a fixed rate using official SwapVM `Salt`, `Deadline`, `StaticBalances` and `LimitSwap` instructions and ships that order through Aqua. The owner can close or replace the quote. A replacement invalidates an investor's previous review; it cannot silently raise the buyer's payment. Quotes expire within one day and the frontend review lasts at most 60 seconds. There is no automatic market maker or automatic repricing daemon. Underwriter coverage collateral is never used as swap inventory.

The router inherits the official LimitSwapVMRouter implementation at `1inch/swap-vm` commit `feb16411738331f7d05ae71d4a664154068018fc`. Preserve upstream license notices. The dependency installer pins that revision.

## Verification

From `contract` (the existing `.env` supplies BASE_SEPOLIA_RPC_URL):

```sh
forge test --via-ir --match-contract NacreSwapVMCheckoutForkTest -vv
```

The suite forks Base Sepolia block 47344900, deploys the actual SwapVM implementation locally, funds a maker order and executes against the existing Nacre and Uniswap contracts. No SwapVM mock is used. It covers single token purchase and settlement, insufficient input, expired/changed/closed quotes, failed coverage rollback, unauthorized spending and donation isolation.

## Activation

Deployed on Base Sepolia and configured for localhost on September 27, 2026. The deployment manifest contains the router, market and checkout addresses plus transaction hashes. The initial maker quote was funded with 1 test nWETH at 2,689.50 nUSDC per nWETH and expires at Unix timestamp 1790547976. The website has not been published by this task.

The following commands can reproduce the deployment or replenish the quote:

1. Install dependencies with `contract/scripts/install-deps.sh` and build using `forge build --via-ir` in `contract`.
2. From `server`, run `bun src/deploy-swapvm.ts` for a dry run. It requires BASE_SEPOLIA_RPC_URL, PRIVATE_KEY and DEPLOYER in the local environment. Do not print or commit secrets.
3. Run `bun src/deploy-swapvm.ts --broadcast` to deploy on Base Sepolia. It persists each deployment and pending hash so a retry resumes rather than blindly redeploying.
4. Fund the maker quote explicitly: set SWAPVM_INVENTORY to the amount of test nWETH to allocate and SWAPVM_PRICE to the desired nUSDC price per nWETH, then run `bun src/deploy-swapvm.ts --broadcast --fund`. This requires that inventory in the deployer wallet. The funding action adds inventory and publishes a quote; do not repeat a confirmed funding transaction unintentionally.
5. Restart/rebuild frontend and backend to pick up the deployment manifest. Verify the wallet flow on testnet before publishing a demo claim.

Only the configured nWETH/nUSDC pair is supported. Other pools continue to use the existing two-token route. Newly deployed contract source must be verified before providing sponsor code/deployment evidence.
