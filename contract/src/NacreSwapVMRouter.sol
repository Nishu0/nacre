// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {LimitSwapVMRouter} from "../lib/swap-vm/contracts/routers/LimitSwapVMRouter.sol";
/// @notice Unmodified official LimitSwapVMRouter opcode set, with Nacre's domain.
contract NacreSwapVMRouter is LimitSwapVMRouter {
    constructor(address aqua, address weth, address owner)
        LimitSwapVMRouter(aqua, weth, owner, "NacreSwapVM", "1") {}
}
