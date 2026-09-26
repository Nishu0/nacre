#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
source .env
set +a
# Constructor arguments are public; keep credentials only in the environment.
python3 - <<'PY' > /tmp/nacre-range-verification.tsv
import json
b=json.load(open('broadcast/NacreRangeOffers.s.sol/84532/run-latest.json'))
for t in b['transactions']:
    if t.get('transactionType')=='CREATE':
        print(t['contractName'],t['contractAddress'],' '.join(t['arguments']),sep='\t')
PY
while IFS=$'\t' read -r name address args; do
  case "$name" in
    NacrePolicyVault) source_file=src/NacrePolicyVault.sol; signature='constructor(address,address,address,address)' ;;
    NacreAquaUnderwriter) source_file=src/NacreAquaUnderwriter.sol; signature='constructor(address,address)' ;;
    NacreRangeOfferFactory) source_file=src/NacreRangeOffers.sol; signature='constructor(address,bytes32)' ;;
    *) continue ;;
  esac
  read -r -a arg_array <<< "$args"
  encoded=$(cast abi-encode "$signature" "${arg_array[@]}")
  forge verify-contract "$address" "$source_file:$name" --chain 84532 --constructor-args "$encoded" --watch
 done < /tmp/nacre-range-verification.tsv
