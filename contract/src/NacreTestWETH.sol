// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely minted Base Sepolia test asset. Not backed by ETH and not redeemable.
contract NacreTestWETH is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1 ether;
    event FaucetClaimed(address indexed recipient, uint256 amount);

    constructor() ERC20("Nacre Test WETH", "nWETH") {}

    function claim() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
