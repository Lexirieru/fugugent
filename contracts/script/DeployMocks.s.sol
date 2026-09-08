// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockLendingPool} from "../src/mocks/MockLendingPool.sol";

/// @title DeployMocks
/// @notice Deploy protokol lending tiruan (bergaya Aave v3) ke BSC testnet, isi
///         likuiditas mUSD, dan buat satu posisi contoh (agunan mBNB, hutang mUSD)
///         dengan health factor sekitar 1.8 — untuk nanti diselamatkan agent.
/// @dev Skrip uji, bukan bagian produk. Tidak menyentuh kontrak Fugu* yang sudah ada.
contract DeployMocks is Script {
    uint16 internal constant USD_LTV_BPS = 8000; // 80%
    uint16 internal constant USD_LT_BPS = 8500; // 85%
    uint16 internal constant BNB_LTV_BPS = 6000; // 60%
    uint16 internal constant BNB_LT_BPS = 7500; // 75%

    int256 internal constant USD_PRICE_8DP = 1_00000000; // $1.00
    int256 internal constant BNB_PRICE_8DP = 750_00000000; // $750.00

    uint256 internal constant MINT_USD = 100_000 ether; // mUSD 18 desimal
    uint256 internal constant MINT_BNB = 100 ether; // mBNB 18 desimal

    uint256 internal constant SEED_LIQUIDITY_USD = 50_000 ether;

    // Posisi contoh: 10 mBNB agunan (= $7,500 @ LT 75% => daya likuidasi $5,625).
    uint256 internal constant SAMPLE_COLLATERAL_BNB = 10 ether;

    // Borrow mUSD supaya HF ~1.8 (lihat perhitungan di komentar `_openSamplePosition`).
    uint256 internal constant SAMPLE_BORROW_USD = 3_125 ether;

    // Gas bekal untuk alamat LP terpisah (lihat catatan di `_seedLiquidity`), dalam wei.
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
        _logResult(d, deployer);
    }

    /// @dev Deploy token, feed, pool; daftarkan aset; mint token ke deployer.
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

    /// @dev Seed likuiditas mUSD ke pool dari alamat LP terpisah — SENGAJA dipisah
    ///      dari deployer. `MockLendingPool.supply()` selalu mencatat penyuplai
    ///      sebagai kolateral miliknya sendiri (persis Aave v3: supply = jadi
    ///      kolateral). Kalau likuiditas disuplai oleh deployer yang sama, saldo
    ///      itu ikut tercampur ke posisi contoh deployer dan merusak target HF
    ///      ~1.8 (Terverifikasi lewat simulasi: tanpa pemisahan ini HF jadi ~15.4,
    ///      bukan ~1.8, karena kolateral deployer ikut menghitung 50.000 mUSD).
    ///      Alamat LP pakai kunci-uji deterministik (bukan rahasia — mock testnet
    ///      saja, tanpa nilai riil), dibekali sedikit gas native oleh deployer.
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

    /// @dev Posisi contoh di alamat deployer: supply mBNB sebagai agunan, lalu
    ///      borrow mUSD sehingga HF berada di sekitar 1.8.
    ///
    ///      HF = (collateralUsd * LTbps) / (10000 * debtUsd) * 1e18
    ///      collateralUsd = 10 * $750 = $7,500 ; LTbps = 7500 (75%)
    ///      Target HF = 1.8e18
    ///      debtUsd = (collateralUsd * LTbps) / (10000 * 1.8)
    ///              = (7500 * 7500) / 18000 = 3,125 USD
    ///      => borrow 3,125 mUSD (harga mUSD = $1.00, jadi 3125 token = $3,125)
    function _openSamplePosition(uint256 pk, Deployed memory d) internal {
        vm.startBroadcast(pk);
        d.mBNB.approve(address(d.pool), SAMPLE_COLLATERAL_BNB);
        d.pool.supply(address(d.mBNB), SAMPLE_COLLATERAL_BNB);
        d.pool.borrow(address(d.mUSD), SAMPLE_BORROW_USD);
        vm.stopBroadcast();
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
        console.log("Borrow mUSD (wei)     ", SAMPLE_BORROW_USD);

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
