// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title FuguPriceOracle
/// @notice Converts a USD amount (8 decimals) into an amount of payment token.
/// @dev The staleness threshold is stored per token because every feed has a
///      different heartbeat: on BSC testnet BNB/USD updates far more often than
///      USDT/USD.
contract FuguPriceOracle is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    enum PriceSourceKind {
        NONE,
        CHAINLINK,
        FIXED_USD
    }

    struct TokenConfig {
        PriceSourceKind kind;
        address feed;
        uint32 maxStaleness;
        uint8 tokenDecimals;
        uint64 fixedPriceUsd8;
        bool enabled;
    }

    /// @dev address(0) means the native coin (tBNB).
    mapping(address token => TokenConfig) private _tokens;

    event TokenConfigured(address indexed token, PriceSourceKind kind, address feed, bool enabled);
    /// @notice The token exposes no readable `decimals()`, so the `tokenDecimals`
    ///         value declared by the owner was accepted without verification.
    event DecimalsUnverified(address indexed token);
    /// @notice The token was disabled via `disableToken`.
    event TokenDisabled(address indexed token);

    error TokenNotEnabled(address token);
    error StalePrice(address token, uint256 updatedAt);
    error FuturePrice(address token, uint256 updatedAt);
    error InvalidPrice(int256 answer);
    error InvalidConfig();
    error DecimalsMismatch(uint8 declared, uint8 actual);

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    /// @notice Configure the price source for a payment token.
    /// @dev `cfg.tokenDecimals` feeds straight into the `quote()` formula, so one wrong
    ///      digit here shifts the price by 10x. That is why for ERC-20 tokens (not the
    ///      native coin) the value declared by the owner is **checked against on-chain
    ///      `decimals()`** and reverts with `DecimalsMismatch` if they differ. If the
    ///      token exposes no `decimals()` (the call fails, or it is not a contract), the
    ///      owner's value is still accepted but the contract emits `DecimalsUnverified`
    ///      so the trace is visible.
    function setToken(address token, TokenConfig calldata cfg) external onlyOwner {
        if (cfg.kind == PriceSourceKind.CHAINLINK) {
            if (cfg.feed == address(0) || cfg.maxStaleness == 0) revert InvalidConfig();
        } else if (cfg.kind == PriceSourceKind.FIXED_USD) {
            if (cfg.fixedPriceUsd8 == 0) revert InvalidConfig();
        } else {
            revert InvalidConfig();
        }
        if (cfg.tokenDecimals == 0 || cfg.tokenDecimals > 36) revert InvalidConfig();

        // address(0) = native coin (tBNB): it has no `decimals()` to check against.
        if (token != address(0)) {
            if (token.code.length == 0) {
                emit DecimalsUnverified(token);
            } else {
                try IERC20Metadata(token).decimals() returns (uint8 actual) {
                    if (actual != cfg.tokenDecimals) revert DecimalsMismatch(cfg.tokenDecimals, actual);
                } catch {
                    emit DecimalsUnverified(token);
                }
            }
        }

        _tokens[token] = cfg;
        emit TokenConfigured(token, cfg.kind, cfg.feed, cfg.enabled);
    }

    /// @notice Turn off a payment token without having to rebuild the full config.
    /// @dev Emergency path: if a token's feed goes bad, the owner must be able to
    ///      disable it immediately. `setToken` demands a config that passes every
    ///      validation, which gets in the way precisely when the old config is already
    ///      invalid. The rest of the config is left as-is so it can be turned back on
    ///      via `setToken`.
    function disableToken(address token) external onlyOwner {
        _tokens[token].enabled = false;
        emit TokenDisabled(token);
    }

    function tokenConfig(address token) external view returns (TokenConfig memory) {
        return _tokens[token];
    }

    /// @notice Price of one unit of the token in USD, 8 decimals.
    function priceUsd8(address token) public view returns (uint256) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);

        if (cfg.kind == PriceSourceKind.FIXED_USD) {
            return cfg.fixedPriceUsd8;
        }

        IAggregatorV3 feed = IAggregatorV3(cfg.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updatedAt > block.timestamp) revert FuturePrice(token, updatedAt);
        if (block.timestamp - updatedAt > cfg.maxStaleness) revert StalePrice(token, updatedAt);

        uint256 feedDecimals = feed.decimals();
        uint256 price = uint256(answer);
        if (feedDecimals > 8) {
            price = price / (10 ** (feedDecimals - 8));
        } else if (feedDecimals < 8) {
            price = price * (10 ** (8 - feedDecimals));
        }
        if (price == 0) revert InvalidPrice(answer);
        return price;
    }

    /// @notice How much `token` is equivalent to `usdAmount8` USD.
    function quote(address token, uint256 usdAmount8) external view returns (uint256 tokenAmount) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);
        uint256 price = priceUsd8(token);
        tokenAmount = (usdAmount8 * (10 ** cfg.tokenDecimals)) / price;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
