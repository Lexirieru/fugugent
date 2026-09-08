// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {Category, Listing} from "./types/FuguTypes.sol";

/// @title FuguRegistry
/// @notice Catalog of agents fit to show in the marketplace, bridging raw
///         ERC-8004 identities with listings that carry a price and a category.
///
/// @dev ## TRUST BOUNDARY — ERC-8004 ownership is NOT verified
///
///      `list()` is permissionless and this contract **does not call the external
///      ERC-8004 registry** to prove that `msg.sender` really owns the
///      `erc8004AgentId` it registers. The only thing guaranteed here is
///      **first-come-first-served uniqueness**: one `erc8004AgentId` can map to only
///      one listing (see `listingByAgentId`), so no two listings fight over the same
///      identity.
///
///      That means an attacker who moves first can still "squat" someone else's agent
///      ID and take payments in that identity's name. For the hackathon/testnet this
///      is accepted knowingly; **verifying ERC-8004 token ownership against the
///      external registry MUST be added before this contract touches real money
///      (mainnet).** Temporary mitigation: the `curated` flag, which only trusted
///      curators can set, and the UI should surface only curated listings.
contract FuguRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, IFuguRegistry {
    uint256 private _listingCount;
    mapping(uint256 listingId => Listing) private _listings;
    mapping(Category => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    // --- new state variables (append-only, added at the END) ---

    /// @notice Maps an ERC-8004 identity -> the listing that has claimed it.
    /// @dev 0 means never claimed (listing ids always start at 1).
    ///      Guarantees uniqueness inside this registry only — it is not proof of
    ///      ownership, see the contract NatSpec.
    mapping(uint256 erc8004AgentId => uint256 listingId) public listingByAgentId;

    event Listed(uint256 indexed listingId, address indexed owner, Category indexed category, uint256 erc8004AgentId);
    event ListingUpdated(uint256 indexed listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI);
    event ActiveChanged(uint256 indexed listingId, bool active);
    event CuratedChanged(uint256 indexed listingId, bool curated);
    event CuratorChanged(address indexed curator, bool allowed);

    error NotListingOwner(uint256 listingId);
    error ListingNotFound(uint256 listingId);
    error InvalidPeriod();
    error NotCurator();
    error AgentAlreadyListed(uint256 erc8004AgentId, uint256 existingListingId);
    error CannotCurateOwnListing();
    error InvalidPrice();

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

    /// @notice Register a new agent in the catalog.
    /// @dev One `erc8004AgentId` may be used by one listing only; a second attempt
    ///      reverts with `AgentAlreadyListed`. This stops two listings from competing
    ///      over the same identity, but it does NOT prove `msg.sender` owns that
    ///      identity — see the contract NatSpec.
    function list(
        uint256 erc8004AgentId,
        address agentWallet,
        Category category,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external returns (uint256 listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();
        if (priceUsd8PerPeriod == 0) revert InvalidPrice();

        uint256 existing = listingByAgentId[erc8004AgentId];
        if (existing != 0) revert AgentAlreadyListed(erc8004AgentId, existing);

        listingId = ++_listingCount;
        listingByAgentId[erc8004AgentId] = listingId;
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
        if (priceUsd8PerPeriod == 0) revert InvalidPrice();
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

    /// @notice Set or clear the curated mark on a listing.
    /// @dev A curator may not curate their own listing (`CannotCurateOwnListing`), so
    ///      an address that happens to hold curator status cannot stamp its own
    ///      listing as trusted.
    function setCurated(uint256 listingId, bool curated) external {
        if (!isCurator[msg.sender]) revert NotCurator();
        address listingOwner = _listings[listingId].owner;
        if (listingOwner == address(0)) revert ListingNotFound(listingId);
        if (msg.sender == listingOwner) revert CannotCurateOwnListing();
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

    /// @notice Total listings EVER created in this category.
    /// @dev This number does not go down when a listing is disabled via
    ///      `setActive(id, false)` — it is a cumulative "ever created" count, not a
    ///      count of currently active listings. Do not read it as the number of
    ///      active listings in the frontend.
    function countByCategory(Category category) external view returns (uint256) {
        return _countByCategory[category];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
