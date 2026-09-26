// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Faucet token for Base Sepolia demos. It has no claim on real USDC.
contract NacreTestUSDC is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 10_000 * 1e6;
    mapping(address => bool) public claimed;

    event FaucetClaimed(address indexed recipient, uint256 amount);

    constructor() ERC20("Nacre Test USDC", "nUSDC") {}

    function decimals() public pure override returns (uint8) { return 6; }

    function claim() external {
        require(!claimed[msg.sender], "Faucet already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, FAUCET_AMOUNT);
    }
}
