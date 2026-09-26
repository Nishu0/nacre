#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  echo "Missing contract/.env" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

broadcast="broadcast/NacreDeploy.s.sol/84532/run-latest.json"
if [[ ! -f "$broadcast" ]]; then
  echo "No Base Sepolia deployment broadcast found." >&2
  exit 1
fi
: "${ETHERSCAN_API_KEY:?Missing Etherscan API key}"
: "${BASE_SEPOLIA_RPC_URL:?Missing Base Sepolia RPC URL}"

address_of() {
  jq -r --arg name "$1" '[.transactions[] | select(.contractName == $name and (.transactionType == "CREATE" or .transactionType == "CREATE2")) | .contractAddress][0] // empty' "$broadcast"
}

verify() {
  local address="$1" contract="$2" arguments="${3:-}"
  [[ -n "$address" ]] || return 0
  local flags=(--chain base-sepolia --rpc-url "$BASE_SEPOLIA_RPC_URL" --watch --etherscan-api-key "$ETHERSCAN_API_KEY")
  [[ -z "$arguments" ]] || flags+=(--constructor-args "$arguments")
  forge verify-contract "$address" "$contract" "${flags[@]}"
}

hook=$(address_of NacreFeeHook)
vault=$(address_of NacrePolicyVault)
app=$(address_of NacreAquaUnderwriter)
oracle=$(address_of NacreChainlinkFeeOracle)
aqua=$(address_of Aqua)

verify "$hook" src/NacreFeeHook.sol:NacreFeeHook \
  "$(cast abi-encode 'constructor(address,address,address)' "$POOL_MANAGER" "$POSITION_MANAGER" "$DEPLOYER")"
if [[ -n "$oracle" ]]; then
  verify "$oracle" src/NacreChainlinkFeeOracle.sol:NacreChainlinkFeeOracle \
    "$(cast abi-encode 'constructor(address,uint256)' "$SETTLEMENT_TOKEN" 7200)"
fi
verify "$vault" src/NacrePolicyVault.sol:NacrePolicyVault \
  "$(cast abi-encode 'constructor(address,address,address,address)' "$SETTLEMENT_TOKEN" "$POSITION_MANAGER" "${oracle:-$FEE_VALUE_ORACLE}" "$hook")"
if [[ -n "$aqua" ]]; then
  FOUNDRY_AUTO_DETECT_REMAPPINGS=true verify "$aqua" lib/aqua/src/Aqua.sol:Aqua
fi
verify "$app" src/NacreAquaUnderwriter.sol:NacreAquaUnderwriter \
  "$(cast abi-encode 'constructor(address,address)' "${aqua:-$AQUA}" "$vault")"
