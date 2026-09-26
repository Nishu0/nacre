// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta, toBalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {NacreFeeHook} from "../src/NacreFeeHook.sol";
import {NacrePolicyVault, INacrePositionManager, INacreFeeValueOracle} from "../src/NacrePolicyVault.sol";
import {NacreAquaUnderwriter} from "../src/NacreAquaUnderwriter.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockPoolManager {
    function collect(NacreFeeHook hook, PoolKey calldata key, uint256 tokenId, uint256 amount0, uint256 amount1)
        external
    {
        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: -60, tickUpper: 60, liquidityDelta: 0, salt: bytes32(tokenId)
        });
        hook.beforeRemoveLiquidity(msg.sender, key, params, "");
        BalanceDelta accrued = toBalanceDelta(int128(uint128(amount0)), int128(uint128(amount1)));
        hook.afterRemoveLiquidity(msg.sender, key, params, BalanceDeltaLibrary.ZERO_DELTA, accrued, "");
    }
}

contract MockPositionManager is ERC721 {
    MockPoolManager public immutable manager;
    NacreFeeHook public immutable hook;
    mapping(uint256 => PoolKey) private keys;
    mapping(uint256 => uint256) public pending0;
    mapping(uint256 => uint256) public pending1;

    constructor(MockPoolManager manager_, NacreFeeHook hook_) ERC721("Mock v4 position", "M-V4") {
        manager = manager_;
        hook = hook_;
    }

    function mint(address owner, uint256 tokenId, PoolKey calldata key) external {
        keys[tokenId] = key;
        _mint(owner, tokenId);
    }

    function addFees(uint256 tokenId, uint256 amount0, uint256 amount1) external {
        pending0[tokenId] += amount0;
        pending1[tokenId] += amount1;
        MockToken(Currency.unwrap(keys[tokenId].currency0)).mint(address(this), amount0);
        MockToken(Currency.unwrap(keys[tokenId].currency1)).mint(address(this), amount1);
    }

    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory, uint256) {
        return (keys[tokenId], 0);
    }

    function modifyLiquidities(bytes calldata unlockData, uint256) external {
        (bytes memory actions, bytes[] memory params) = abi.decode(unlockData, (bytes, bytes[]));
        require(keccak256(actions) == keccak256(hex"010f"), "unexpected actions");
        (uint256 tokenId, uint256 liquidity,,,) = abi.decode(params[0], (uint256, uint256, uint128, uint128, bytes));
        require(liquidity == 0 && ownerOf(tokenId) == msg.sender, "not owner");
        uint256 amount0 = pending0[tokenId];
        uint256 amount1 = pending1[tokenId];
        pending0[tokenId] = 0;
        pending1[tokenId] = 0;
        PoolKey memory key = keys[tokenId];
        manager.collect(hook, key, tokenId, amount0, amount1);
        if (amount0 != 0) MockToken(Currency.unwrap(key.currency0)).transfer(msg.sender, amount0);
        if (amount1 != 0) MockToken(Currency.unwrap(key.currency1)).transfer(msg.sender, amount1);
    }
}

contract MockFeeOracle is INacreFeeValueOracle {
    address public immutable usdc;
    address public immutable weth;
    constructor(address usdc_, address weth_) { usdc = usdc_; weth = weth_; }
    function quote(address token, uint256 amount) external view returns (uint256) {
        if (token == usdc) return amount;
        if (token == weth) return amount * 2_000e6 / 1e18;
        revert("unsupported token");
    }
}

contract NacreFlowTest is Test {
    address internal lp = makeAddr("lp");
    address internal maker = makeAddr("maker");
    address internal attacker = makeAddr("attacker");
    MockToken internal usdc;
    MockToken internal weth;
    MockPoolManager internal manager;
    MockPositionManager internal positions;
    MockFeeOracle internal oracle;
    NacreFeeHook internal hook;
    NacrePolicyVault internal vault;
    NacreAquaUnderwriter internal app;
    Aqua internal aqua;
    PoolKey internal key;

    function setUp() public {
        usdc = new MockToken("USD Coin", "USDC");
        weth = new MockToken("Wrapped Ether", "WETH");
        manager = new MockPoolManager();
        // The mock PositionManager address is known before deployment in this test.
        address nextPositionManager = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        hook = new NacreFeeHook(IPoolManager(address(manager)), nextPositionManager, address(this));
        positions = new MockPositionManager(manager, hook);
        oracle = new MockFeeOracle(address(usdc), address(weth));
        aqua = new Aqua();
        vault = new NacrePolicyVault(usdc, INacrePositionManager(address(positions)), oracle, hook);
        app = new NacreAquaUnderwriter(aqua, vault);
        hook.setController(address(vault));
        vault.setAquaApp(address(app));
        key = PoolKey({
            currency0: Currency.wrap(address(usdc)), currency1: Currency.wrap(address(weth)),
            fee: 500, tickSpacing: 10, hooks: IHooks(address(hook))
        });
        positions.mint(lp, 1, key);
        usdc.mint(lp, 1_000e6);
        usdc.mint(maker, 1_000e6);
    }

    function _request() internal returns (uint256 id) {
        vm.startPrank(lp);
        positions.approve(address(vault), 1);
        id = vault.createRequest(key, 1, 1_000e6, 500e6, 30 days, uint64(block.timestamp + 1 days));
        vm.stopPrank();
    }

    function _quote(uint256 requestId) internal returns (NacreAquaUnderwriter.Quote memory quote) {
        quote = NacreAquaUnderwriter.Quote({
            maker: maker, requestId: requestId, premium: 24e6, payoutCap: 500e6,
            expiresAt: uint64(block.timestamp + 1 days), salt: bytes32(uint256(77))
        });
        vm.startPrank(maker);
        usdc.approve(address(aqua), 500e6);
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 500e6;
        aqua.ship(address(app), abi.encode(quote), tokens, amounts);
        vm.stopPrank();
    }

    function testFullAquaCoverageAndCappedSettlement() public {
        // Fees earned before coverage go to the LP and do not count toward floor.
        positions.addFees(1, 100e6, 0);
        uint256 id = _request();
        NacreAquaUnderwriter.Quote memory quote = _quote(id);
        vm.startPrank(lp);
        usdc.approve(address(app), 24e6);
        app.buyCoverage(quote);
        vm.stopPrank();

        assertEq(usdc.balanceOf(lp), 1_076e6);
        assertEq(usdc.balanceOf(maker), 524e6);
        assertEq(usdc.balanceOf(address(vault)), 500e6);
        assertEq(positions.ownerOf(1), address(vault));
        assertEq(vault.reservedCollateral(), 500e6);

        positions.addFees(1, 600e6, 0);
        vm.warp(block.timestamp + 30 days);
        vm.prank(attacker);
        uint256 payout = vault.settle(id);

        assertEq(payout, 400e6);
        assertEq(usdc.balanceOf(lp), 2_076e6); // 600 fees + 400 payout
        assertEq(usdc.balanceOf(maker), 624e6); // 24 premium + 100 unused collateral
        assertEq(positions.ownerOf(1), lp);
        assertEq(vault.reservedCollateral(), 0);
    }

    function testCannotActivateWithoutRealAquaCollateral() public {
        uint256 id = _request();
        NacreAquaUnderwriter.Quote memory quote = _quote(id);
        vm.prank(maker);
        usdc.approve(address(aqua), 0);
        vm.startPrank(lp);
        usdc.approve(address(app), 24e6);
        vm.expectRevert();
        app.buyCoverage(quote);
        vm.stopPrank();
        assertEq(positions.ownerOf(1), address(vault));
        assertEq(vault.reservedCollateral(), 0);
    }

    function testCoveredPositionRejectsLiquidityRemoval() public {
        uint256 id = _request();
        NacreAquaUnderwriter.Quote memory quote = _quote(id);
        vm.startPrank(lp);
        usdc.approve(address(app), 24e6);
        app.buyCoverage(quote);
        vm.stopPrank();

        ModifyLiquidityParams memory params = ModifyLiquidityParams({
            tickLower: -60, tickUpper: 60, liquidityDelta: -1, salt: bytes32(uint256(1))
        });
        vm.prank(address(manager));
        vm.expectRevert(NacreFeeHook.CoveredPositionCannotChangeLiquidity.selector);
        hook.beforeRemoveLiquidity(address(positions), key, params, "");
    }

    function testZeroFeesPaysOnlyCappedShortfallOnce() public {
        uint256 id = _request();
        NacreAquaUnderwriter.Quote memory quote = _quote(id);
        vm.startPrank(lp);
        usdc.approve(address(app), 24e6);
        app.buyCoverage(quote);
        vm.stopPrank();
        vm.warp(block.timestamp + 30 days);
        assertEq(vault.settle(id), 500e6);
        vm.expectRevert(NacrePolicyVault.InvalidStatus.selector);
        vault.settle(id);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function testUnfilledRequestCanReturnNFTAfterDeadline() public {
        uint256 id = _request();
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(lp);
        vault.cancel(id);
        assertEq(positions.ownerOf(1), lp);
    }
}
