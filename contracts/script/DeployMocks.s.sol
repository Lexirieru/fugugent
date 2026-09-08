// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockLendingPool} from "../src/mocks/MockLendingPool.sol";

/// @title DeployMocks
/// @notice Deploys a fake lending protocol (Aave v3 style) to BSC testnet, seeds mUSD
///         liquidity, and opens one sample position (mBNB collateral, mUSD debt) with a
///         health factor around 1.8 — for an agent to rescue later.
/// @dev A test script, not part of the product. It does not touch the existing Fugu*
///      contracts. WARNING: this script ALWAYS deploys a completely fresh set of mocks
///      (token+feed+pool) on every run — there is no idempotency guard. Running it
///      repeatedly against the same testnet piles up many unused mock sets (each at a
///      different address). Run it only once per need, and record the resulting addresses
///      in `deployments/bsc-testnet.json`.
contract DeployMocks is Script {
    uint16 internal constant USD_LTV_BPS = 8000; // 80%
    uint16 internal constant USD_LT_BPS = 8500; // 85%
    uint16 internal constant BNB_LTV_BPS = 6000; // 60%
    uint16 internal constant BNB_LT_BPS = 7500; // 75%

    int256 internal constant USD_PRICE_8DP = 1_00000000; // $1.00
    int256 internal constant BNB_PRICE_8DP = 750_00000000; // $750.00

    uint256 internal constant MINT_USD = 100_000 ether; // mUSD, 18 decimals
    uint256 internal constant MINT_BNB = 100 ether; // mBNB, 18 decimals

    uint256 internal constant SEED_LIQUIDITY_USD = 50_000 ether;

    // Sample position: 10 mBNB of collateral (= $7,500 @ LT 75% => $5,625 of borrowing power).
    uint256 internal constant SAMPLE_COLLATERAL_BNB = 10 ether;

    // Target health factor for the sample position, and the tolerance of its runtime check.
    // The borrow amount is DERIVED from this (see `_computeSampleBorrowAmount`), not a
    // hardcoded number — so it cannot silently drift if the price or LT changes.
    uint256 internal constant TARGET_HF = 1.8e18;
    uint256 internal constant HF_TOLERANCE = 0.01e18;

    // Gas stipend for the separate LP address (see the note in `_seedLiquidity`), in wei.
    uint256 internal constant LP_GAS_STIPEND = 0.002 ether;

    struct Deployed {
        MockToken mUSD;
        MockToken mBNB;
        MockPriceFeed feedUSD;
        MockPriceFeed feedBNB;
        MockLendingPool pool;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        Deployed memory d = _deployAndConfigure(pk, deployer);
        _seedLiquidity(pk, d);
        _openSamplePosition(pk, d);
        _verifySampleHealthFactor(d, deployer);
        _logResult(d, deployer);
    }

    /// @dev Deploy tokens, feeds, pool; register the assets; mint tokens to the deployer.
    function _deployAndConfigure(uint256 pk, address deployer) internal returns (Deployed memory d) {
        vm.startBroadcast(pk);

        d.mUSD = new MockToken("Mock USD", "mUSD");
        d.mBNB = new MockToken("Mock BNB", "mBNB");

        d.feedUSD = new MockPriceFeed(8, USD_PRICE_8DP);
        d.feedBNB = new MockPriceFeed(8, BNB_PRICE_8DP);

        d.pool = new MockLendingPool(deployer);

        d.pool.addAsset(address(d.mUSD), address(d.feedUSD), USD_LTV_BPS, USD_LT_BPS);
        d.pool.addAsset(address(d.mBNB), address(d.feedBNB), BNB_LTV_BPS, BNB_LT_BPS);

        d.mUSD.mint(deployer, MINT_USD);
        d.mBNB.mint(deployer, MINT_BNB);

        vm.stopBroadcast();
    }

    /// @dev Seed mUSD liquidity into the pool from a separate LP address — DELIBERATELY
    ///      kept apart from the deployer. `MockLendingPool.supply()` always records the
    ///      supplier's deposit as their own collateral (exactly like Aave v3: supply =
    ///      becomes collateral). If the same deployer supplied the liquidity, that balance
    ///      would get mixed into the deployer's sample position and wreck the ~1.8 HF
    ///      target (Verified by simulation: without this separation the HF comes out at
    ///      ~15.4 instead of ~1.8, because the deployer's collateral then counts the
    ///      50,000 mUSD too). The LP address uses a deterministic test key (not a secret —
    ///      testnet mocks only, with no real value), funded with a little native gas by
    ///      the deployer.
    function _seedLiquidity(uint256 pk, Deployed memory d) internal {
        uint256 lpPk = uint256(keccak256("fugu-mock-lending-lp-testnet-seed"));
        address lp = vm.addr(lpPk);

        vm.startBroadcast(pk);
        d.mUSD.mint(lp, SEED_LIQUIDITY_USD);
        (bool sentGas,) = payable(lp).call{value: LP_GAS_STIPEND}("");
        require(sentGas, "gas stipend to LP failed");
        vm.stopBroadcast();

        vm.startBroadcast(lpPk);
        d.mUSD.approve(address(d.pool), SEED_LIQUIDITY_USD);
        d.pool.supply(address(d.mUSD), SEED_LIQUIDITY_USD);
        vm.stopBroadcast();

        console.log("LP (penyuplai likuid.)", lp);
    }

    /// @dev Sample position at the deployer's address: supply mBNB as collateral, then
    ///      borrow an mUSD amount COMPUTED from `TARGET_HF`, not a hardcoded number, using
    ///      exactly the same formula as `MockLendingPool.getUserAccountData`:
    ///
    ///      healthFactor = (totalCollateralBase * currentLiquidationThreshold * 1e18)
    ///                     / (10000 * totalDebtBase)
    ///
    ///      Inverted for debt (multiply first, divide last, to keep precision):
    ///
    ///      totalDebtBase = (collateralUsd8 * ltBps * 1e18) / (10000 * TARGET_HF)
    ///
    ///      This position has only ONE collateral asset (mBNB), so
    ///      `currentLiquidationThreshold` equals `BNB_LT_BPS` exactly (a weighted average
    ///      over one asset is that asset itself).
    function _openSamplePosition(uint256 pk, Deployed memory d) internal {
        uint256 borrowAmount = _computeSampleBorrowAmount();

        vm.startBroadcast(pk);
        d.mBNB.approve(address(d.pool), SAMPLE_COLLATERAL_BNB);
        d.pool.supply(address(d.mBNB), SAMPLE_COLLATERAL_BNB);
        d.pool.borrow(address(d.mUSD), borrowAmount);
        vm.stopBroadcast();
    }

    /// @dev Derive the mUSD borrow amount (18 decimals) from `TARGET_HF` and the sample
    ///      position parameters (`SAMPLE_COLLATERAL_BNB`, `BNB_PRICE_8DP`, `BNB_LT_BPS`,
    ///      `USD_PRICE_8DP`) — not a hardcoded number.
    function _computeSampleBorrowAmount() internal pure returns (uint256 borrowAmount) {
        // collateralUsd8 = mBNB amount (18dp) * mBNB price (8dp) / 1e18
        uint256 collateralUsd8 = (SAMPLE_COLLATERAL_BNB * uint256(BNB_PRICE_8DP)) / 1e18;

        // totalDebtBase (usd8) = (collateralUsd8 * ltBps * 1e18) / (10000 * TARGET_HF)
        // — multiply first, divide last, same as the healthFactor formula in the contract.
        uint256 targetDebtUsd8 = (collateralUsd8 * BNB_LT_BPS * 1e18) / (10_000 * TARGET_HF);

        // borrowAmount (mUSD, 18dp) = targetDebtUsd8 (8dp) * 1e18 / mUSD price (8dp)
        borrowAmount = (targetDebtUsd8 * 1e18) / uint256(USD_PRICE_8DP);
    }

    /// @dev A runtime check BEFORE printing the result: fail hard (rather than just
    ///      printing a wrong number) if the sample position's HF misses `TARGET_HF` by
    ///      more than `HF_TOLERANCE` — e.g. because one of the parameters above was
    ///      changed without adjusting the others.
    function _verifySampleHealthFactor(Deployed memory d, address deployer) internal view {
        (,,,,, uint256 healthFactor) = d.pool.getUserAccountData(deployer);

        uint256 diff = healthFactor > TARGET_HF ? healthFactor - TARGET_HF : TARGET_HF - healthFactor;

        require(
            diff <= HF_TOLERANCE,
            string.concat(
                "HF posisi contoh meleset dari target: got=",
                vm.toString(healthFactor),
                " expected~=",
                vm.toString(TARGET_HF),
                " tolerance=",
                vm.toString(HF_TOLERANCE)
            )
        );
    }

    function _logResult(Deployed memory d, address deployer) internal view {
        console.log("=== Alamat ===");
        console.log("MockTokenUSD (mUSD)   ", address(d.mUSD));
        console.log("MockTokenBNB (mBNB)   ", address(d.mBNB));
        console.log("MockPriceFeedUSD      ", address(d.feedUSD));
        console.log("MockPriceFeedBNB      ", address(d.feedBNB));
        console.log("MockLendingPool       ", address(d.pool));
        console.log("Deployer              ", deployer);

        console.log("=== Posisi contoh ===");
        console.log("Supply mBNB (wei)     ", SAMPLE_COLLATERAL_BNB);
        console.log("Borrow mUSD (wei)     ", _computeSampleBorrowAmount());

        (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        ) = d.pool.getUserAccountData(deployer);

        console.log("=== getUserAccountData(deployer) ===");
        console.log("totalCollateralBase   ", totalCollateralBase);
        console.log("totalDebtBase         ", totalDebtBase);
        console.log("availableBorrowsBase  ", availableBorrowsBase);
        console.log("currentLiquidationThr ", currentLiquidationThreshold);
        console.log("ltv                   ", ltv);
        console.log("healthFactor          ", healthFactor);
    }
}
