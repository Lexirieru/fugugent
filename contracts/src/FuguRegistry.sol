// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";

/// @title FuguRegistry
/// @notice Katalog agent yang layak ditampilkan di marketplace, menjembatani
///         identitas ERC-8004 yang mentah dengan listing yang punya harga dan kategori.
contract FuguRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, IFuguRegistry {
    // NOTE: Category dan Listing dideklarasikan langsung di sini (bukan di
    // IFuguRegistry) supaya `FuguRegistry.Category` / `FuguRegistry.Listing`
    // bisa di-resolve dari luar kontrak (dipakai oleh test). IFuguRegistry.sol
    // meng-import kontrak ini untuk memakai ulang tipe `Listing` pada
    // signature `getListing`. Lihat komentar di IFuguRegistry.sol.
    enum Category {
        REBALANCING,
        GRID,
        YIELD,
        HEALTH_FACTOR
    }

    struct Listing {
        uint256 erc8004AgentId;
        address owner;
        address agentWallet;
        Category category;
        uint128 priceUsd8PerPeriod;
        uint32 periodSeconds;
        bool active;
        bool curated;
        string metadataURI;
    }

    uint256 private _listingCount;
    mapping(uint256 listingId => Listing) private _listings;
    mapping(Category => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    event Listed(uint256 indexed listingId, address indexed owner, Category indexed category, uint256 erc8004AgentId);
    event ListingUpdated(uint256 indexed listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI);
    event ActiveChanged(uint256 indexed listingId, bool active);
    event CuratedChanged(uint256 indexed listingId, bool curated);
    event CuratorChanged(address indexed curator, bool allowed);

    error NotListingOwner(uint256 listingId);
    error ListingNotFound(uint256 listingId);
    error InvalidPeriod();
    error NotCurator();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    modifier onlyListingOwner(uint256 listingId) {
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        if (_listings[listingId].owner != msg.sender) revert NotListingOwner(listingId);
        _;
    }

    function list(
        uint256 erc8004AgentId,
        address agentWallet,
        Category category,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external returns (uint256 listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();

        listingId = ++_listingCount;
        _listings[listingId] = Listing({
            erc8004AgentId: erc8004AgentId,
            owner: msg.sender,
            agentWallet: agentWallet,
            category: category,
            priceUsd8PerPeriod: priceUsd8PerPeriod,
            periodSeconds: periodSeconds,
            active: true,
            curated: false,
            metadataURI: metadataURI
        });
        unchecked {
            ++_countByCategory[category];
        }
        emit Listed(listingId, msg.sender, category, erc8004AgentId);
    }

    function updateListing(
        uint256 listingId,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external onlyListingOwner(listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();
        Listing storage l = _listings[listingId];
        l.priceUsd8PerPeriod = priceUsd8PerPeriod;
        l.periodSeconds = periodSeconds;
        l.metadataURI = metadataURI;
        emit ListingUpdated(listingId, priceUsd8PerPeriod, periodSeconds, metadataURI);
    }

    function setActive(uint256 listingId, bool active) external onlyListingOwner(listingId) {
        _listings[listingId].active = active;
        emit ActiveChanged(listingId, active);
    }

    function setCurator(address curator, bool allowed) external onlyOwner {
        isCurator[curator] = allowed;
        emit CuratorChanged(curator, allowed);
    }

    function setCurated(uint256 listingId, bool curated) external {
        if (!isCurator[msg.sender]) revert NotCurator();
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        _listings[listingId].curated = curated;
        emit CuratedChanged(listingId, curated);
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        return _listings[listingId];
    }

    function listingCount() external view returns (uint256) {
        return _listingCount;
    }

    function countByCategory(Category category) external view returns (uint256) {
        return _countByCategory[category];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
