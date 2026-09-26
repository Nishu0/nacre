// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NacreIllustrativeSettlement} from "../src/NacreIllustrativeSettlement.sol";
contract ReplayToken is ERC20 {
    constructor() ERC20("Test USD", "TUSD") {}
    function mint(address recipient, uint256 value) external { _mint(recipient, value); }
}
contract NacreIllustrativeSettlementTest is Test {
    ReplayToken token;
    NacreIllustrativeSettlement demo;
    address investor = address(0x1234);
    function setUp() public {
        vm.chainId(84532);
        token = new ReplayToken();
        demo = new NacreIllustrativeSettlement(token, investor, keccak256("synthetic scenario"));
        token.mint(address(this), 100e6); token.mint(investor, 100e6);
        token.approve(address(demo), 10e6);
        vm.prank(investor); token.approve(address(demo), 1.8e6);
    }
    function testActualTransfersWithDisclosedSyntheticInput() public {
        demo.fund(); vm.prank(investor); demo.purchase();
        vm.prank(address(0x777)); demo.settle();
        assertEq(token.balanceOf(investor), 99.6e6);
        assertEq(token.balanceOf(address(this)), 100.4e6);
        assertEq(token.balanceOf(address(demo)), 0);
        assertEq(uint256(demo.stage()), 3);
        vm.expectRevert("Cannot settle"); demo.settle();
    }
    function testCannotSpendFromOtherWalletsOrSettleBeforePurchase() public {
        vm.prank(investor); vm.expectRevert("Cannot fund"); demo.fund();
        demo.fund(); vm.expectRevert("Cannot purchase"); demo.purchase();
        vm.expectRevert("Cannot settle"); demo.settle();
    }
    function testFundingCanBeCancelledBeforePurchase() public {
        demo.fund(); demo.cancel(); assertEq(token.balanceOf(address(this)), 100e6);
        vm.prank(investor); vm.expectRevert("Cannot purchase"); demo.purchase();
    }
    function testNoCancellationAfterPremiumPaid() public {
        demo.fund(); vm.prank(investor); demo.purchase();
        vm.expectRevert("Cannot cancel"); demo.cancel();
    }
    function testWrongNetworkCannotDeploy() public {
        vm.chainId(1); vm.expectRevert("Base Sepolia only");
        new NacreIllustrativeSettlement(token, investor, keccak256("scenario"));
    }
}
