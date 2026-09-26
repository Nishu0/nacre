#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  echo "Missing contract/.env; copy .env.example and fill its values." >&2
  exit 1
fi
if [[ $(stat -f %Lp .env) != 600 ]]; then
  echo "Set contract/.env permissions to 600 before deploying." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
: "${BASE_SEPOLIA_RPC_URL:?Missing Base Sepolia RPC URL}"
: "${ETHERSCAN_API_KEY:?Missing Etherscan API key}"
: "${PRIVATE_KEY:?Missing deployer private key}"
: "${DEPLOYER:?Missing deployer address}"
: "${POOL_MANAGER:?Missing v4 PoolManager}"
: "${POSITION_MANAGER:?Missing v4 PositionManager}"
: "${SETTLEMENT_TOKEN:?Missing test USDC}"
: "${WETH:?Missing WETH token}"
: "${WETH_USD_FEED:?Missing ETH/USD feed}"

chain_id=$(cast chain-id --rpc-url "$BASE_SEPOLIA_RPC_URL")
if [[ "$chain_id" != 84532 ]]; then
  echo "Expected Base Sepolia (84532), got $chain_id." >&2
  exit 1
fi
derived_address=$(cast wallet address --private-key "$PRIVATE_KEY")
if [[ "$(printf '%s' "$derived_address" | tr '[:upper:]' '[:lower:]')" != "$(printf '%s' "$DEPLOYER" | tr '[:upper:]' '[:lower:]')" ]]; then
  echo "DEPLOYER does not match PRIVATE_KEY." >&2
  exit 1
fi
balance=$(cast balance "$DEPLOYER" --rpc-url "$BASE_SEPOLIA_RPC_URL")
if [[ "$balance" == 0 ]]; then
  echo "Fund $DEPLOYER with Base Sepolia test ETH first." >&2
  exit 1
fi

echo "Deploying and verifying Nacre on Base Sepolia from $DEPLOYER"
forge script script/NacreDeploy.s.sol:NacreDeploy \
  --rpc-url "$BASE_SEPOLIA_RPC_URL" \
  --chain-id 84532 \
  --broadcast

# Verify separately so Aqua's dependency remappings do not pollute Nacre's
# source paths on BaseScan. Safe to rerun without broadcasting again.
./scripts/verify-base-sepolia.sh
