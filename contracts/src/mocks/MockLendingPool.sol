// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockLendingPool
/// @notice Tiruan pool lending ber-antarmuka Aave v3, untuk testnet BSC.
/// @dev Kontrak uji, bukan bagian produk: tidak upgradeable, tidak ada `__gap`,
///      tidak pakai UUPS/Initializable. `getUserAccountData` mengembalikan enam
///      nilai dengan urutan dan satuan persis Aave v3 supaya adapter TypeScript
///      yang sudah ada (`readAavePosition`, yang membaca lewat posisi tuple bukan
///      nama field) bisa dipakai apa adanya, hanya dengan mengganti alamat pool.
contract MockLendingPool is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant HEALTH_FACTOR_FLOOR = 1e18;

    struct AssetConfig {
        address feed;
        uint16 ltvBps;
        uint16 liquidationThresholdBps;
        uint8 tokenDecimals;
        bool enabled;
    }

    mapping(address asset => AssetConfig) public assets;

    /// @dev saldo agunan dan hutang per user, dalam satuan token asli (bukan USD).
    mapping(address user => mapping(address asset => uint256)) public collateralBalance;
    mapping(address user => mapping(address asset => uint256)) public debtBalance;

    /// @dev daftar aset yang pernah disentuh user, dipakai untuk iterasi di
    ///      `getUserAccountData`. Append-only per user; tidak dihapus saat saldo
    ///      jadi nol karena kesederhanaan lebih penting daripada hemat gas di mock.
    mapping(address user => address[]) private _userCollateralAssets;
    mapping(address user => address[]) private _userDebtAssets;
    mapping(address user => mapping(address asset => bool)) private _isCollateralAssetTracked;
    mapping(address user => mapping(address asset => bool)) private _isDebtAssetTracked;

    event AssetAdded(address indexed asset, address indexed feed, uint16 ltvBps, uint16 liquidationThresholdBps);
    event Supply(address indexed user, address indexed asset, uint256 amount);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);
    event Borrow(address indexed user, address indexed asset, uint256 amount);
    event Repay(address indexed user, address indexed asset, uint256 amount);

    error AssetNotSupported(address asset);
    error ZeroAmount();
    error InvalidConfig();
    error InvalidPrice(address asset);
    error InsufficientCollateral(address asset, uint256 available, uint256 requested);
    error InsufficientPoolLiquidity(address asset, uint256 available, uint256 requested);
    error NoDebt(address asset);
    error HealthFactorTooLow(uint256 healthFactor);

    constructor(address owner_) Ownable(owner_) {}

    /// @notice Daftarkan atau perbarui konfigurasi sebuah aset yang bisa dipakai sebagai agunan/hutang.
    function addAsset(address token, address feed, uint16 ltvBps, uint16 liquidationThresholdBps)
        external
        onlyOwner
    {
        if (token == address(0) || feed == address(0)) revert InvalidConfig();
        if (ltvBps > BPS_DENOMINATOR || liquidationThresholdBps > BPS_DENOMINATOR) revert InvalidConfig();

        uint8 tokenDecimals = IERC20Metadata(token).decimals();

        assets[token] = AssetConfig({
            feed: feed,
            ltvBps: ltvBps,
            liquidationThresholdBps: liquidationThresholdBps,
            tokenDecimals: tokenDecimals,
            enabled: true
        });

        emit AssetAdded(token, feed, ltvBps, liquidationThresholdBps);
    }

    /// @notice Setor `asset` sebagai agunan.
    function supply(address asset, uint256 amount) external nonReentrant {
        AssetConfig memory cfg = assets[asset];
        if (!cfg.enabled) revert AssetNotSupported(asset);
        if (amount == 0) revert ZeroAmount();

        collateralBalance[msg.sender][asset] += amount;
        _trackAsset(_userCollateralAssets[msg.sender], _isCollateralAssetTracked[msg.sender], asset);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        emit Supply(msg.sender, asset, amount);
    }

    /// @notice Tarik `asset` dari agunan. Ditolak bila membuat `healthFactor` turun di bawah 1e18.
    function withdraw(address asset, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 balance = collateralBalance[msg.sender][asset];
        if (balance < amount) revert InsufficientCollateral(asset, balance, amount);

        collateralBalance[msg.sender][asset] = balance - amount;

        (,,,,, uint256 healthFactor) = getUserAccountData(msg.sender);
        if (healthFactor < HEALTH_FACTOR_FLOOR) revert HealthFactorTooLow(healthFactor);

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Withdraw(msg.sender, asset, amount);
    }

    /// @notice Pinjam `asset` dari likuiditas pool. Ditolak bila membuat `healthFactor` turun di bawah 1e18.
    function borrow(address asset, uint256 amount) external nonReentrant {
        AssetConfig memory cfg = assets[asset];
        if (!cfg.enabled) revert AssetNotSupported(asset);
        if (amount == 0) revert ZeroAmount();

        uint256 poolBalance = IERC20(asset).balanceOf(address(this));
        if (poolBalance < amount) revert InsufficientPoolLiquidity(asset, poolBalance, amount);

        debtBalance[msg.sender][asset] += amount;
        _trackAsset(_userDebtAssets[msg.sender], _isDebtAssetTracked[msg.sender], asset);

        (,,,,, uint256 healthFactor) = getUserAccountData(msg.sender);
        if (healthFactor < HEALTH_FACTOR_FLOOR) revert HealthFactorTooLow(healthFactor);

        IERC20(asset).safeTransfer(msg.sender, amount);

        emit Borrow(msg.sender, asset, amount);
    }

    /// @notice Lunasi hutang `asset`. Kelebihan pembayaran dipangkas ke sisa hutang.
    function repay(address asset, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 debt = debtBalance[msg.sender][asset];
        if (debt == 0) revert NoDebt(asset);

        uint256 repayAmount = amount > debt ? debt : amount;
        debtBalance[msg.sender][asset] = debt - repayAmount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repay(msg.sender, asset, repayAmount);
    }

    /// @notice Posisi akun `user`, dalam urutan dan satuan persis Aave v3:
    ///         `*Base` USD 8 desimal, `ltv`/`currentLiquidationThreshold` basis
    ///         poin, `healthFactor` basis 1e18 (`type(uint256).max` bila tanpa hutang).
    function getUserAccountData(address user)
        public
        view
        returns (
            uint256 totalCollateralBase,
            uint256 totalDebtBase,
            uint256 availableBorrowsBase,
            uint256 currentLiquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        )
    {
        address[] memory collateralAssets = _userCollateralAssets[user];
        uint256 weightedLiquidationThreshold;
        uint256 weightedLtv;

        for (uint256 i = 0; i < collateralAssets.length; i++) {
            address asset = collateralAssets[i];
            uint256 balance = collateralBalance[user][asset];
            if (balance == 0) continue;

            AssetConfig memory cfg = assets[asset];
            uint256 valueUsd8 = _valueUsd8(asset, cfg, balance);

            totalCollateralBase += valueUsd8;
            weightedLiquidationThreshold += valueUsd8 * cfg.liquidationThresholdBps;
            weightedLtv += valueUsd8 * cfg.ltvBps;
        }

        address[] memory debtAssets = _userDebtAssets[user];
        for (uint256 i = 0; i < debtAssets.length; i++) {
            address asset = debtAssets[i];
            uint256 balance = debtBalance[user][asset];
            if (balance == 0) continue;

            AssetConfig memory cfg = assets[asset];
            totalDebtBase += _valueUsd8(asset, cfg, balance);
        }

        if (totalCollateralBase > 0) {
            currentLiquidationThreshold = weightedLiquidationThreshold / totalCollateralBase;
            ltv = weightedLtv / totalCollateralBase;
        }

        healthFactor = totalDebtBase == 0
            ? type(uint256).max
            : (totalCollateralBase * currentLiquidationThreshold * 1e18) / (BPS_DENOMINATOR * totalDebtBase);

        uint256 maxBorrowBase = (totalCollateralBase * ltv) / BPS_DENOMINATOR;
        availableBorrowsBase = maxBorrowBase > totalDebtBase ? maxBorrowBase - totalDebtBase : 0;
    }

    /// @dev Nilai USD 8 desimal dari `amount` unit token `asset`, memakai konfigurasi
    ///      yang sudah dimuat (`cfg`) supaya tidak membaca storage dua kali di loop caller.
    function _valueUsd8(address asset, AssetConfig memory cfg, uint256 amount) private view returns (uint256) {
        uint256 price = _priceUsd8(asset, cfg);
        return (amount * price) / (10 ** cfg.tokenDecimals);
    }

    /// @dev Harga `asset` dinormalkan ke 8 desimal, mengikuti konvensi `*Usd8` di seluruh proyek.
    function _priceUsd8(address asset, AssetConfig memory cfg) private view returns (uint256) {
        (, int256 answer,,,) = IAggregatorV3(cfg.feed).latestRoundData();
        if (answer <= 0) revert InvalidPrice(asset);

        uint256 price = uint256(answer);
        uint8 feedDecimals = IAggregatorV3(cfg.feed).decimals();
        if (feedDecimals > 8) {
            price = price / (10 ** (feedDecimals - 8));
        } else if (feedDecimals < 8) {
            price = price * (10 ** (8 - feedDecimals));
        }
        return price;
    }

    /// @dev Menambahkan `asset` ke daftar aset user hanya sekali (idempotent, append-only).
    function _trackAsset(address[] storage list, mapping(address => bool) storage tracked, address asset) private {
        if (!tracked[asset]) {
            tracked[asset] = true;
            list.push(asset);
        }
    }
}
