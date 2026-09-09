// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ---------------------------------------------------------------------------------
// FROZEN COPY. Do not "improve" this file, do not keep it in sync with `src/`.
//
// This is `src/FuguRegistry.sol` and `src/types/FuguTypes.sol` exactly as they stood
// BEFORE the catalog was widened from four categories to nine, with the two files
// merged and the type names suffixed `Legacy` so a frozen copy can never accidentally
// reference today's enum. It is the implementation whose bytecode is deployed at
// `0xd68968cf68e9930a689e0fc9d648a898050a548a` on BSC testnet and sits behind the live
// proxy `0xb2f36070E6eae3353E8e755172B477DF213ae248`.
//
// It exists so `test/CategoryUpgradeSafety.t.sol` can register listings the way the
// live proxy registered them, upgrade to the current implementation, and read them
// back. Without a frozen old implementation the test would only ever compare the new
// code against itself, which proves nothing about the listings already on chain.
//
// Regenerated from git with (run from the repo root, at commit
// 2179e1f or any commit before the expansion):
//
//     git show <pre-expansion-commit>:contracts/src/types/FuguTypes.sol
//     git show <pre-expansion-commit>:contracts/src/FuguRegistry.sol
//
// The only edits applied to that source: the SPDX/pragma lines were dropped from both
// halves, the two `import`s that pointed at the shared type file and `IFuguRegistry`
// were removed (an interface carries no storage, so removing it changes no slot),
// `Category` -> `CategoryLegacy`, `Listing` -> `ListingLegacy`, `FuguRegistry` ->
// `FuguRegistryLegacy`. Storage layout is therefore identical, which is the only
// property the test depends on.
// ---------------------------------------------------------------------------------

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @notice Shared types for the agent listing catalog, declared at file level
///         (not inside any contract or interface) so that both `IFuguRegistry`
///         and `FuguRegistry` can import them without creating an
///         interface -> implementation dependency.
enum CategoryLegacy {
    REBALANCING,
    GRID,
    YIELD,
    HEALTH_FACTOR
}

/// @notice One agent catalog entry.
/// @dev The roles of `owner` and `agentWallet` are deliberately separate and
///      **must never be swapped** — see the NatSpec on each field.
struct ListingLegacy {
    /// @notice The ERC-8004 identity ID this listing claims.
    /// @dev WARNING: `FuguRegistry` only guarantees this ID is unique within
    ///      its own registry; it does NOT verify against the external ERC-8004
    ///      registry that `owner` actually owns that ID.
    uint256 erc8004AgentId;
    /// @notice The listing owner — **this is who gets paid**.
    /// @dev Every subscription payout (`FuguSubscription.claim`) goes to this
    ///      address, not to `agentWallet`. `owner` is also the only address
    ///      allowed to call `updateListing` and `setActive`.
    address owner;
    /// @notice The agent's operational address (the Altana wallet that executes transactions).
    /// @dev **NEVER receives any payment.** This field is pure metadata: the UI
    ///      uses it to link the agent's on-chain activity (rebalancing txs, grid
    ///      orders, and so on) back to its listing. No payment logic in
    ///      `FuguSubscription` reads it. Do not treat it as a payee.
    address agentWallet;
    CategoryLegacy category;
    uint128 priceUsd8PerPeriod;
    uint32 periodSeconds;
    bool active;
    bool curated;
    string metadataURI;
}

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
contract FuguRegistryLegacy is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    uint256 private _listingCount;
    mapping(uint256 listingId => ListingLegacy) private _listings;
    mapping(CategoryLegacy => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    // --- new state variables (append-only, added at the END) ---

    /// @notice Maps an ERC-8004 identity -> the listing that has claimed it.
    /// @dev 0 means never claimed (listing ids always start at 1).
    ///      Guarantees uniqueness inside this registry only — it is not proof of
    ///      ownership, see the contract NatSpec.
    mapping(uint256 erc8004AgentId => uint256 listingId) public listingByAgentId;

    event Listed(uint256 indexed listingId, address indexed owner, CategoryLegacy indexed category, uint256 erc8004AgentId);
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
        CategoryLegacy category,
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
        _listings[listingId] = ListingLegacy({
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
        ListingLegacy storage l = _listings[listingId];
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

    function getListing(uint256 listingId) external view returns (ListingLegacy memory) {
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
    function countByCategory(CategoryLegacy category) external view returns (uint256) {
        return _countByCategory[category];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
