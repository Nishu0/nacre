#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p lib

if [ ! -f lib/forge-std/src/Test.sol ]; then
  forge install foundry-rs/forge-std --no-git
fi

install_locked() {
  local folder="$1" repository="$2" revision="$3"
  if [ ! -d "lib/$folder/.git" ]; then
    git clone --filter=blob:none "$repository" "lib/$folder"
  fi
  git -C "lib/$folder" fetch --depth 1 origin "$revision"
  git -C "lib/$folder" checkout --detach "$revision"
}

install_locked v4-core https://github.com/Uniswap/v4-core.git 46c6834698c48bc4a463a86d8420f4eb1d7f3b75
install_locked v4-periphery https://github.com/Uniswap/v4-periphery.git 9969eec44cfdf07e24b41de47f40276a58401976
install_locked aqua https://github.com/1inch/aqua.git ef24220ed9647555727b06867bf509cd6959d84b
install_locked solidity-utils https://github.com/1inch/solidity-utils.git 4df02bddf562c2e1cb5de5dc98f3cf077926b79f
install_locked openzeppelin-contracts https://github.com/OpenZeppelin/openzeppelin-contracts.git 4858ab13a5ad897f59753028f6315f9d487c4322

install_locked swap-vm https://github.com/1inch/swap-vm.git feb16411738331f7d05ae71d4a664154068018fc
