# Nacre contracts

Foundry workspace for Nacre's Solidity contracts.

`NacrePayout.sol` contains the pure, capped fee-floor calculation:

```text
payout = min(max(feeFloor - eligibleFees, 0), payoutCap)
```

All values use the same settlement-token denomination and decimals. The function performs no token transfers and makes no claim about how eligible fees are measured; those responsibilities belong to the policy and settlement architecture described in [Nacre's README](../README.md).

```bash
cd contract
forge install foundry-rs/forge-std --no-git
forge build
forge test --offline
```

The `script/NacrePayout.s.sol` script deploys the calculation contract with Foundry's normal broadcast configuration.
