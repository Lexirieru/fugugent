// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title FuguPriceOracle
/// @notice Mengubah jumlah USD (8 desimal) menjadi jumlah token pembayaran.
/// @dev Ambang staleness disimpan per token karena tiap feed punya heartbeat
///      berbeda: di BSC testnet BNB/USD update jauh lebih sering daripada USDT/USD.
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

    /// @dev address(0) berarti native coin (tBNB).
    mapping(address token => TokenConfig) private _tokens;

    event TokenConfigured(address indexed token, PriceSourceKind kind, address feed, bool enabled);

    error TokenNotEnabled(address token);
    error StalePrice(address token, uint256 updatedAt);
    error InvalidPrice(int256 answer);
    error InvalidConfig();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    function setToken(address token, TokenConfig calldata cfg) external onlyOwner {
        if (cfg.kind == PriceSourceKind.CHAINLINK) {
            if (cfg.feed == address(0) || cfg.maxStaleness == 0) revert InvalidConfig();
        } else if (cfg.kind == PriceSourceKind.FIXED_USD) {
            if (cfg.fixedPriceUsd8 == 0) revert InvalidConfig();
        } else {
            revert InvalidConfig();
        }
        if (cfg.tokenDecimals == 0 || cfg.tokenDecimals > 36) revert InvalidConfig();

        _tokens[token] = cfg;
        emit TokenConfigured(token, cfg.kind, cfg.feed, cfg.enabled);
    }

    function tokenConfig(address token) external view returns (TokenConfig memory) {
        return _tokens[token];
    }

    /// @notice Harga satu unit token dalam USD, 8 desimal.
    function priceUsd8(address token) public view returns (uint256) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);

        if (cfg.kind == PriceSourceKind.FIXED_USD) {
            return cfg.fixedPriceUsd8;
        }

        IAggregatorV3 feed = IAggregatorV3(cfg.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
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

    /// @notice Berapa banyak `token` yang setara dengan `usdAmount8` USD.
    function quote(address token, uint256 usdAmount8) external view returns (uint256 tokenAmount) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);
        uint256 price = priceUsd8(token);
        tokenAmount = (usdAmount8 * (10 ** cfg.tokenDecimals)) / price;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
