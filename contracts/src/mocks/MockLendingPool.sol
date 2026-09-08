// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockLendingPool
/// @notice A fake lending pool with the Aave v3 interface, for BSC testnet.
/// @dev A test contract, not part of the product: not upgradeable, no `__gap`, no
///      UUPS/Initializable. `getUserAccountData` returns six values in exactly Aave
///      v3's order and units so that the existing TypeScript adapter
///      (`readAavePosition`, which reads by tuple position rather than field name)
///      works as-is, just by swapping the pool address.
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

    /// @dev per-user collateral and debt balances, in native token units (not USD).
    mapping(address user => mapping(address asset => uint256)) public collateralBalance;
    mapping(address user => mapping(address asset => uint256)) public debtBalance;

    /// @dev the list of assets a user has ever touched, used to iterate in
    ///      `getUserAccountData`. Append-only per user; entries are not removed when a
    ///      balance hits zero, because simplicity matters more than saving gas in a mock.
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

    /// @notice Register or update the configuration of an asset usable as collateral/debt.
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

    /// @notice Supply `asset` as collateral.
    function supply(address asset, uint256 amount) external nonReentrant {
        AssetConfig memory cfg = assets[asset];
        if (!cfg.enabled) revert AssetNotSupported(asset);
        if (amount == 0) revert ZeroAmount();

        collateralBalance[msg.sender][asset] += amount;
        _trackAsset(_userCollateralAssets[msg.sender], _isCollateralAssetTracked[msg.sender], asset);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        emit Supply(msg.sender, asset, amount);
    }

    /// @notice Withdraw `asset` from collateral. Rejected if it would drop `healthFactor` below 1e18.
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

    /// @notice Borrow `asset` from the pool's liquidity. Rejected if it would drop `healthFactor` below 1e18.
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

    /// @notice Repay `asset` debt. Overpayment is clamped to the remaining debt.
    function repay(address asset, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 debt = debtBalance[msg.sender][asset];
        if (debt == 0) revert NoDebt(asset);

        uint256 repayAmount = amount > debt ? debt : amount;
        debtBalance[msg.sender][asset] = debt - repayAmount;

        IERC20(asset).safeTransferFrom(msg.sender, address(this), repayAmount);

        emit Repay(msg.sender, asset, repayAmount);
    }

    /// @notice The account position of `user`, in exactly Aave v3's order and units:
    ///         `*Base` in USD with 8 decimals, `ltv`/`currentLiquidationThreshold` in
    ///         basis points, `healthFactor` on a 1e18 basis (`type(uint256).max` when
    ///         there is no debt).
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

    /// @dev The USD value, 8 decimals, of `amount` units of token `asset`, using the
    ///      already-loaded config (`cfg`) to avoid reading storage twice in the caller's loop.
    function _valueUsd8(address asset, AssetConfig memory cfg, uint256 amount) private view returns (uint256) {
        uint256 price = _priceUsd8(asset, cfg);
        return (amount * price) / (10 ** cfg.tokenDecimals);
    }

    /// @dev The price of `asset` normalized to 8 decimals, following the `*Usd8` convention used throughout the project.
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

    /// @dev Adds `asset` to the user's asset list only once (idempotent, append-only).
    function _trackAsset(address[] storage list, mapping(address => bool) storage tracked, address asset) private {
        if (!tracked[asset]) {
            tracked[asset] = true;
            list.push(asset);
        }
    }
}
