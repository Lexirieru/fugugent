// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockLendingPool} from "../src/mocks/MockLendingPool.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Menguji `MockLendingPool` terhadap rumus Aave v3 yang mengikat, sehingga
///      adapter TypeScript `readAavePosition` (yang membaca `getUserAccountData`
///      lewat urutan posisi, bukan nama field) bisa dipakai apa adanya di testnet.
contract MockLendingPoolTest is Test {
    uint256 internal constant WAD = 1e18;

    MockLendingPool internal pool;

    MockToken internal collateralToken; // "cA" — dipakai sebagai agunan utama
    MockToken internal debtToken; // "dB" — dipakai sebagai aset yang dipinjam

    MockPriceFeed internal collateralFeed; // $10 per token, 8 desimal
    MockPriceFeed internal debtFeed; // $1 per token, 8 desimal

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

        // Lender menyuplai likuiditas dB supaya bisa dipinjam borrower.
        debtToken.mint(lender, 10_000 ether);
        vm.startPrank(lender);
        debtToken.approve(address(pool), type(uint256).max);
        pool.supply(address(debtToken), 10_000 ether);
        vm.stopPrank();

        // Borrower disiapkan dengan agunan.
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
        _supplyCollateral(100 ether); // 100 token * $10 = $1000

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

        collateralFeed.setAnswer(5e8); // $5.00, setengah dari $10

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
        vm.prank(borrower);
        vm.expectPartialRevert(MockLendingPool.HealthFactorTooLow.selector);
        pool.borrow(address(debtToken), 301 ether);
    }

    function test_borrowRevertsWhenPoolLacksLiquidity() public {
        _supplyCollateral(100 ether); // agunan cukup untuk HF, tapi likuiditas aset pinjaman nol

        MockToken illiquidToken = new MockToken("Illiquid", "ILQ");
        MockPriceFeed illiquidFeed = new MockPriceFeed(8, 1e8);
        pool.addAsset(address(illiquidToken), address(illiquidFeed), 5000, 6000);
        // Tidak ada siapa pun yang men-supply illiquidToken ke pool -> saldo pool = 0.

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
        vm.prank(borrower);
        vm.expectPartialRevert(MockLendingPool.HealthFactorTooLow.selector);
        pool.withdraw(address(collateralToken), 40 ether);
    }

    function test_withdrawRevertsWhenAmountExceedsCollateral() public {
        _supplyCollateral(50 ether); // tanpa hutang sama sekali — ini murni jalur over-withdraw

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
        // HF = (630e8 * 8000 * 1e18) / (10000 * 500e8) = 1.008e18 tepat
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
        _borrow(500 ether); // borrower menerima 500 ether dB dari pool, itu juga saldo dB-nya sekarang

        uint256 balBefore = debtToken.balanceOf(borrower);

        // Borrower mengajukan pelunasan jauh lebih besar dari hutangnya (500 ether).
        vm.prank(borrower);
        pool.repay(address(debtToken), 10_000 ether);

        (, uint256 totalDebtBase,,,,) = pool.getUserAccountData(borrower);
        assertEq(totalDebtBase, 0);

        uint256 balAfter = debtToken.balanceOf(borrower);
        // Hanya sisa hutang lama (500 ether) yang benar-benar ditarik, bukan 10_000 ether yang diajukan.
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

        // rata-rata tertimbang: (600*8000 + 400*5000) / 1000 = 6800
        assertEq(currentLiquidationThreshold, 6800);
        // rata-rata tertimbang ltv: (600*6000 + 400*4000) / 1000 = 5200
        assertEq(ltv, 5200);
    }

    // ---------------------------------------------------------------
    // penskalaan desimal feed (bukan 8) — bug penskalaan tidak akan terdeteksi
    // kalau semua test lain memakai feed 8 desimal.
    // ---------------------------------------------------------------

    function test_priceScalingFromFeedWith18Decimals() public {
        MockToken token18 = new MockToken("Token 18dp feed", "T18");
        MockPriceFeed feed18 = new MockPriceFeed(18, 2e18); // $2.00, feed 18 desimal

        pool.addAsset(address(token18), address(feed18), 5000, 6000);

        token18.mint(borrower, 50 ether);
        vm.startPrank(borrower);
        token18.approve(address(pool), type(uint256).max);
        pool.supply(address(token18), 50 ether); // 50 token * $2.00 = $100
        vm.stopPrank();

        (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(borrower);
        assertEq(totalCollateralBase, 100 * 1e8);
    }

    function test_priceScalingFromFeedWith6Decimals() public {
        MockToken token6 = new MockToken("Token 6dp feed", "T6");
        MockPriceFeed feed6 = new MockPriceFeed(6, 2_000_000); // $2.00, feed 6 desimal

        pool.addAsset(address(token6), address(feed6), 5000, 6000);

        token6.mint(borrower, 50 ether);
        vm.startPrank(borrower);
        token6.approve(address(pool), type(uint256).max);
        pool.supply(address(token6), 50 ether); // 50 token * $2.00 = $100
        vm.stopPrank();

        (uint256 totalCollateralBase,,,,,) = pool.getUserAccountData(borrower);
        // Skala feed berbeda (18 vs 6 desimal), tapi harga USD yang dinormalkan sama
        // ($2.00) dan jumlah token yang disupply sama -> nilai USD harus identik
        // dengan test_priceScalingFromFeedWith18Decimals.
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
