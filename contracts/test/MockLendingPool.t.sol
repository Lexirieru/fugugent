// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockLendingPool} from "../src/mocks/MockLendingPool.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Tests `MockLendingPool` against the binding Aave v3 formula, so the TypeScript
///      adapter `readAavePosition` (which reads `getUserAccountData` by position order,
///      not by field name) works as-is on testnet.
contract MockLendingPoolTest is Test {
    uint256 internal constant WAD = 1e18;

    MockLendingPool internal pool;

    MockToken internal collateralToken; // "cA" — used as the main collateral
    MockToken internal debtToken; // "dB" — used as the borrowed asset

    MockPriceFeed internal collateralFeed; // $10 per token, 8 decimals
    MockPriceFeed internal debtFeed; // $1 per token, 8 decimals

    address internal borrower = address(0xB0B);
    address internal lender = address(0x1E4DE7);

    uint16 internal constant COLLATERAL_LTV_BPS = 7000; // 70%
    uint16 internal constant COLLATERAL_LT_BPS = 8000; // 80%
    uint16 internal constant DEBT_LTV_BPS = 7500;
    uint16 internal constant DEBT_LT_BPS = 8500;

    function setUp() public {
        pool = new MockLendingPool(address(this));

        collateralToken = new MockToken("Collateral Token", "cA");
        debtToken = new MockToken("Debt Token", "dB");

        collateralFeed = new MockPriceFeed(8, 10e8); // $10.00
        debtFeed = new MockPriceFeed(8, 1e8); // $1.00

        pool.addAsset(address(collateralToken), address(collateralFeed), COLLATERAL_LTV_BPS, COLLATERAL_LT_BPS);
        pool.addAsset(address(debtToken), address(debtFeed), DEBT_LTV_BPS, DEBT_LT_BPS);

        // The lender supplies dB liquidity so the borrower can borrow it.
        debtToken.mint(lender, 10_000 ether);
        vm.startPrank(lender);
        debtToken.approve(address(pool), type(uint256).max);
        pool.supply(address(debtToken), 10_000 ether);
        vm.stopPrank();

        // The borrower is set up with collateral.
        collateralToken.mint(borrower, 1_000 ether);
        vm.prank(borrower);
        collateralToken.approve(address(pool), type(uint256).max);
        vm.prank(borrower);
        debtToken.approve(address(pool), type(uint256).max);
    }

    function _supplyCollateral(uint256 amount) internal {
        vm.prank(borrower);
        pool.supply(address(collateralToken), amount);
    }

    function _borrow(uint256 amount) internal {
        vm.prank(borrower);
        pool.borrow(address(debtToken), amount);
    }

    // ---------------------------------------------------------------
    // supply
    // ---------------------------------------------------------------

    function test_supplyIncreasesTotalCollateralBaseByFeedPrice() public {
        _supplyCollateral(100 ether); // 100 tokens * $10 = $1000

        (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(borrower);
        assertEq(totalCollateralBase, 1000 * 1e8);
    }

    function test_supplyPullsTokensFromCaller() public {
        uint256 balBefore = collateralToken.balanceOf(borrower);
        _supplyCollateral(100 ether);
        assertEq(collateralToken.balanceOf(borrower), balBefore - 100 ether);
        assertEq(collateralToken.balanceOf(address(pool)), 100 ether);
    }

    // ---------------------------------------------------------------
    // healthFactor sentinel
    // ---------------------------------------------------------------

    function test_healthFactorIsMaxUint256WithoutDebt() public {
        _supplyCollateral(100 ether);

        (uint256 totalCollateralBase, uint256 totalDebtBase,,,, uint256 healthFactor) =
            pool.getUserAccountData(borrower);

        assertEq(totalDebtBase, 0);
        assertGt(totalCollateralBase, 0);
        assertEq(healthFactor, type(uint256).max);
    }

    function test_healthFactorIsMaxUint256WithNoPositionAtAll() public view {
        (,,,,, uint256 healthFactor) = pool.getUserAccountData(address(0xDEAD));
        assertEq(healthFactor, type(uint256).max);
    }

    // ---------------------------------------------------------------
    // supply + borrow: exact health factor
    // ---------------------------------------------------------------

    function test_supply1000Borrow500AtLt80GivesExactHealthFactor() public {
        _supplyCollateral(100 ether); // $1000 @ LT 80%
        _borrow(500 ether); // $500 debt

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        ) = pool.getUserAccountData(borrower);

        assertEq(totalCollateralBase, 1000 * 1e8);
        assertEq(totalDebtBase, 500 * 1e8);
        assertEq(currentLiquidationThreshold, COLLATERAL_LT_BPS);
        assertEq(ltv, COLLATERAL_LTV_BPS);
        assertEq(healthFactor, 1.6e18);

        // availableBorrowsBase = max(0, 1000 * 7000/10000 - 500) = max(0, 700-500) = 200
        assertEq(availableBorrowsBase, 200 * 1e8);
    }

    function test_collateralPriceHalvingDropsHealthFactorToExpectedValue() public {
        _supplyCollateral(100 ether);
        _borrow(500 ether);

        collateralFeed.setAnswer(5e8); // $5.00, half of $10

        (,,,,, uint256 healthFactor) = pool.getUserAccountData(borrower);
        assertEq(healthFactor, 0.8e18);
    }

    // ---------------------------------------------------------------
    // borrow / withdraw guarded by health factor
    // ---------------------------------------------------------------

    function test_borrowRevertsWhenItWouldDropHealthFactorBelowOne() public {
        _supplyCollateral(100 ether); // $1000 @ LT 80% -> liquidation ceiling debt = $800
        _borrow(500 ether); // $500 debt, HF = 1.6

        // Additional $301 pushes total debt to $801 > $800 ceiling => HF < 1
        // HF = (1000e8 * 8000 * 1e18) / (10000 * 801e8) = 998751560549313358 exactly
        // (computed with Python integer division, formula identical to the contract).
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(MockLendingPool.HealthFactorTooLow.selector, 998751560549313358));
        pool.borrow(address(debtToken), 301 ether);
    }

    function test_borrowRevertsWhenPoolLacksLiquidity() public {
        _supplyCollateral(100 ether); // enough collateral for HF, but zero liquidity in the borrowed asset

        MockToken illiquidToken = new MockToken("Illiquid", "ILQ");
        MockPriceFeed illiquidFeed = new MockPriceFeed(8, 1e8);
        pool.addAsset(address(illiquidToken), address(illiquidFeed), 5000, 6000);
        // Nobody has supplied illiquidToken to the pool -> pool balance = 0.

        vm.prank(borrower);
        vm.expectRevert(
            abi.encodeWithSelector(MockLendingPool.InsufficientPoolLiquidity.selector, address(illiquidToken), 0, 1 ether)
        );
        pool.borrow(address(illiquidToken), 1 ether);
    }

    function test_borrowSucceedsExactlyAtHealthFactorFloor() public {
        _supplyCollateral(100 ether);
        // Borrowing exactly $800 -> HF == 1e18 (allowed, since guard rejects strictly below 1e18)
        _borrow(800 ether);

        (,,,,, uint256 healthFactor) = pool.getUserAccountData(borrower);
        assertEq(healthFactor, 1e18);
    }

    function test_withdrawRevertsWhenItWouldDropHealthFactorBelowOne() public {
        _supplyCollateral(100 ether); // $1000
        _borrow(500 ether); // $500 debt, HF = 1.6

        // Withdrawing 40 tokens ($400) leaves $600 collateral; ceiling debt becomes $480 < $500 debt => HF < 1
        // HF = (600e8 * 8000 * 1e18) / (10000 * 500e8) = 960000000000000000 (0.96e18) exactly
        // (computed with Python integer division, formula identical to the contract).
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(MockLendingPool.HealthFactorTooLow.selector, 960000000000000000));
        pool.withdraw(address(collateralToken), 40 ether);
    }

    function test_withdrawRevertsWhenAmountExceedsCollateral() public {
        _supplyCollateral(50 ether); // no debt at all — this is purely the over-withdraw path

        vm.prank(borrower);
        vm.expectRevert(
            abi.encodeWithSelector(MockLendingPool.InsufficientCollateral.selector, address(collateralToken), 50 ether, 51 ether)
        );
        pool.withdraw(address(collateralToken), 51 ether);
    }

    function test_withdrawSucceedsWhenHealthFactorStaysAtOrAboveOne() public {
        _supplyCollateral(100 ether);
        _borrow(500 ether);

        // Withdrawing 37 tokens ($370) leaves $630 collateral; ceiling debt = $504 >= $500 debt => still healthy
        vm.prank(borrower);
        pool.withdraw(address(collateralToken), 37 ether);

        (,,,,, uint256 healthFactor) = pool.getUserAccountData(borrower);
        // totalCollateralBase = 630*1e8, currentLiquidationThreshold = 8000, totalDebtBase = 500*1e8
        // HF = (630e8 * 8000 * 1e18) / (10000 * 500e8) = 1.008e18 exactly
        assertEq(healthFactor, 1.008e18);
    }

    function test_withdrawWithoutDebtNeverReverts() public {
        _supplyCollateral(100 ether);

        vm.prank(borrower);
        pool.withdraw(address(collateralToken), 100 ether);

        assertEq(collateralToken.balanceOf(borrower), 1_000 ether);
    }

    // ---------------------------------------------------------------
    // repay
    // ---------------------------------------------------------------

    function test_repayIncreasesHealthFactor() public {
        _supplyCollateral(100 ether);
        _borrow(500 ether);

        (,,,,, uint256 healthFactorBefore) = pool.getUserAccountData(borrower);

        vm.prank(borrower);
        pool.repay(address(debtToken), 250 ether);

        (, uint256 totalDebtBaseAfter,,,, uint256 healthFactorAfter) = pool.getUserAccountData(borrower);

        assertEq(totalDebtBaseAfter, 250 * 1e8);
        assertGt(healthFactorAfter, healthFactorBefore);
    }

    function test_repayOnlyPullsOutstandingDebt() public {
        _supplyCollateral(100 ether);
        _borrow(500 ether); // the borrower receives 500 ether dB from the pool, which is also their dB balance now

        uint256 balBefore = debtToken.balanceOf(borrower);

        // The borrower offers a repayment far larger than their debt (500 ether).
        vm.prank(borrower);
        pool.repay(address(debtToken), 10_000 ether);

        (, uint256 totalDebtBase,,,,) = pool.getUserAccountData(borrower);
        assertEq(totalDebtBase, 0);

        uint256 balAfter = debtToken.balanceOf(borrower);
        // Only the remaining old debt (500 ether) is actually pulled, not the 10_000 ether offered.
        assertEq(balBefore - balAfter, 500 ether);
    }

    function test_repayFullDebtRestoresMaxHealthFactor() public {
        _supplyCollateral(100 ether);
        _borrow(500 ether);

        vm.prank(borrower);
        pool.repay(address(debtToken), 500 ether);

        (, uint256 totalDebtBase,,,, uint256 healthFactor) = pool.getUserAccountData(borrower);
        assertEq(totalDebtBase, 0);
        assertEq(healthFactor, type(uint256).max);
    }

    // ---------------------------------------------------------------
    // weighted average across two collaterals with different LT
    // ---------------------------------------------------------------

    function test_weightedAverageLiquidationThresholdAcrossTwoCollaterals() public {
        MockToken tokenA = new MockToken("Token A", "TA");
        MockToken tokenB = new MockToken("Token B", "TB");
        MockPriceFeed feedA = new MockPriceFeed(8, 10e8); // $10.00
        MockPriceFeed feedB = new MockPriceFeed(8, 10e8); // $10.00

        uint16 ltvA = 6000;
        uint16 ltA = 8000; // 80%
        uint16 ltvB = 4000;
        uint16 ltB = 5000; // 50%

        pool.addAsset(address(tokenA), address(feedA), ltvA, ltA);
        pool.addAsset(address(tokenB), address(feedB), ltvB, ltB);

        address user = address(0xCAFE);
        tokenA.mint(user, 60 ether); // $600
        tokenB.mint(user, 40 ether); // $400

        vm.startPrank(user);
        tokenA.approve(address(pool), type(uint256).max);
        tokenB.approve(address(pool), type(uint256).max);
        pool.supply(address(tokenA), 60 ether);
        pool.supply(address(tokenB), 40 ether);
        vm.stopPrank();

        (uint256 totalCollateralBase,,, uint256 currentLiquidationThreshold, uint256 ltv,) =
            pool.getUserAccountData(user);

        assertEq(totalCollateralBase, 1000 * 1e8);

        // weighted average: (600*8000 + 400*5000) / 1000 = 6800
        assertEq(currentLiquidationThreshold, 6800);
        // weighted average ltv: (600*6000 + 400*4000) / 1000 = 5200
        assertEq(ltv, 5200);
    }

    // ---------------------------------------------------------------
    // scaling for feeds whose decimals are not 8 — a scaling bug would go undetected
    // if every other test used an 8-decimal feed.
    // ---------------------------------------------------------------

    function test_priceScalingFromFeedWith18Decimals() public {
        MockToken token18 = new MockToken("Token 18dp feed", "T18");
        MockPriceFeed feed18 = new MockPriceFeed(18, 2e18); // $2.00, 18-decimal feed

        pool.addAsset(address(token18), address(feed18), 5000, 6000);

        token18.mint(borrower, 50 ether);
        vm.startPrank(borrower);
        token18.approve(address(pool), type(uint256).max);
        pool.supply(address(token18), 50 ether); // 50 tokens * $2.00 = $100
        vm.stopPrank();

        (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(borrower);
        assertEq(totalCollateralBase, 100 * 1e8);
    }

    function test_priceScalingFromFeedWith6Decimals() public {
        MockToken token6 = new MockToken("Token 6dp feed", "T6");
        MockPriceFeed feed6 = new MockPriceFeed(6, 2_000_000); // $2.00, 6-decimal feed

        pool.addAsset(address(token6), address(feed6), 5000, 6000);

        token6.mint(borrower, 50 ether);
        vm.startPrank(borrower);
        token6.approve(address(pool), type(uint256).max);
        pool.supply(address(token6), 50 ether); // 50 tokens * $2.00 = $100
        vm.stopPrank();

        (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(borrower);
        // Different feed scales (18 vs 6 decimals), but the normalized USD price is the
        // same ($2.00) and the supplied token amount is the same -> the USD value must be
        // identical to test_priceScalingFromFeedWith18Decimals.
        assertEq(totalCollateralBase, 100 * 1e8);
    }

    // ---------------------------------------------------------------
    // access control / config
    // ---------------------------------------------------------------

    function test_addAssetRevertsForNonOwner() public {
        vm.prank(borrower);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, borrower));
        pool.addAsset(address(collateralToken), address(collateralFeed), 1, 1);
    }

    function test_supplyRevertsForUnsupportedAsset() public {
        MockToken unsupported = new MockToken("Unsupported", "U");
        unsupported.mint(borrower, 1 ether);
        vm.startPrank(borrower);
        unsupported.approve(address(pool), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(MockLendingPool.AssetNotSupported.selector, address(unsupported)));
        pool.supply(address(unsupported), 1 ether);
        vm.stopPrank();
    }
}
