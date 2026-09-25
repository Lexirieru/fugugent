// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {Category, Listing} from "./types/FuguTypes.sol";

/// @title FuguRegistry
/// @notice Catalog of agents fit to show in the marketplace, bridging raw
///         ERC-8004 identities with listings that carry a price and a category.
///
/// @dev ## TRUST BOUNDARY — ERC-8004 ownership is verified once `identityRegistry` is set
///
///      Once the owner has pointed `identityRegistry` at the ERC-8004 IdentityRegistry
///      (an ERC-721), `list()` asks it who owns `erc8004AgentId` and refuses anyone who is
///      not that owner (`NotAgentIdentityOwner`). A nonexistent id is refused with the
///      same error: the registry's own `ownerOf` revert is caught and re-raised as ours,
///      so a builder sees one clear reason instead of an ERC-721 error from a contract
///      they did not call.
///
///      While `identityRegistry` is still `address(0)` — every proxy deployed before this
///      version, and every fresh proxy until the owner calls `setIdentityRegistry` — the
///      old behaviour holds: `list()` is permissionless and only guarantees
///      **first-come-first-served uniqueness** (one `erc8004AgentId` maps to one listing,
///      see `listingByAgentId`). That is exactly how listings 1..9 on BSC testnet came to
///      hold the placeholder ids 8004..8012, which were never minted in the real
///      IdentityRegistry and would collide with real third-party agents once it grows
///      that far. `rebindAgentId` is how those listings move onto identities that exist.
///
///      What ownership is checked AT: the moment of `list()` or `rebindAgentId()`. If the
///      identity token is transferred afterwards, the listing (and its payout `owner`)
///      stays where it was; nothing here watches ERC-721 transfers. The `curated` flag,
///      which only trusted curators can set, remains the signal the UI should lean on.
contract FuguRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, IFuguRegistry {
    uint256 private _listingCount;
    mapping(uint256 listingId => Listing) private _listings;
    mapping(Category => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    // --- new state variables (append-only, added at the END) ---

    /// @notice Maps an ERC-8004 identity -> the listing that has claimed it.
    /// @dev 0 means never claimed (listing ids always start at 1).
    ///      Guarantees uniqueness inside this registry. Ownership is a separate check,
    ///      made against `identityRegistry` when that is set; see the contract NatSpec.
    ///      A key of 0 is a real ERC-8004 id (the IdentityRegistry mints from 0); only a
    ///      VALUE of 0 means "unclaimed".
    mapping(uint256 erc8004AgentId => uint256 listingId) public listingByAgentId;

    /// @notice The ERC-8004 IdentityRegistry (ERC-721) that `list()` and `rebindAgentId()`
    ///         check ownership against. `address(0)` means not configured: `list()` then
    ///         skips the check and `rebindAgentId()` refuses to run at all.
    /// @dev Appended at slot 5, after `listingByAgentId`. Every proxy upgraded to this
    ///      version reads it as zero until the owner calls `setIdentityRegistry`, which
    ///      is what keeps the upgrade itself from changing who may call `list()`.
    address public identityRegistry;

    event Listed(uint256 indexed listingId, address indexed owner, Category indexed category, uint256 erc8004AgentId);
    event ListingUpdated(uint256 indexed listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI);
    event ActiveChanged(uint256 indexed listingId, bool active);
    event CuratedChanged(uint256 indexed listingId, bool curated);
    event CuratorChanged(address indexed curator, bool allowed);
    event IdentityRegistryChanged(address indexed identityRegistry);
    event AgentIdRebound(uint256 indexed listingId, uint256 indexed oldErc8004AgentId, uint256 indexed newErc8004AgentId);

    error NotListingOwner(uint256 listingId);
    error ListingNotFound(uint256 listingId);
    error InvalidPeriod();
    error NotCurator();
    error AgentAlreadyListed(uint256 erc8004AgentId, uint256 existingListingId);
    error CannotCurateOwnListing();
    error InvalidPrice();
    /// @dev `identityOwner` is `address(0)` when the id does not exist in the identity
    ///      registry (its `ownerOf` reverted).
    error NotAgentIdentityOwner(uint256 erc8004AgentId, address caller, address identityOwner);
    error IdentityRegistryNotSet();
    error InvalidIdentityRegistry(address identityRegistry);

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
    ///      reverts with `AgentAlreadyListed`. When `identityRegistry` is set, the caller
    ///      must also own `erc8004AgentId` there (`NotAgentIdentityOwner`); when it is not
    ///      set, ownership is not checked — see the contract NatSpec.
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
        if (identityRegistry != address(0)) _requireIdentityOwner(erc8004AgentId);

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

    /// @notice Move a listing onto a different ERC-8004 identity, keeping everything else.
    /// @dev Exists for the listings created before ownership was checked, whose ids
    ///      (8004..8012 on BSC testnet) were placeholders that no IdentityRegistry token
    ///      backs. Only `erc8004AgentId` and the two `listingByAgentId` entries change:
    ///      the listing id, price, period, category, `agentWallet`, `owner`, flags,
    ///      metadata and every subscription (which `FuguSubscription` keys by listing id)
    ///      are untouched.
    ///
    ///      Requires the caller to own the listing AND `newErc8004AgentId` in
    ///      `identityRegistry`, and refuses to run while no identity registry is set —
    ///      without the ownership check, rebinding would be a way to squat an identity
    ///      after the fact. `newErc8004AgentId` must not already be claimed by any
    ///      listing, this one included (`AgentAlreadyListed`).
    ///
    ///      The old id is released: `listingByAgentId[old]` goes back to 0, so the real
    ///      owner of that id in the IdentityRegistry can list it later.
    function rebindAgentId(uint256 listingId, uint256 newErc8004AgentId) external onlyListingOwner(listingId) {
        if (identityRegistry == address(0)) revert IdentityRegistryNotSet();
        uint256 existing = listingByAgentId[newErc8004AgentId];
        if (existing != 0) revert AgentAlreadyListed(newErc8004AgentId, existing);
        _requireIdentityOwner(newErc8004AgentId);

        Listing storage l = _listings[listingId];
        uint256 oldErc8004AgentId = l.erc8004AgentId;
        delete listingByAgentId[oldErc8004AgentId];
        listingByAgentId[newErc8004AgentId] = listingId;
        l.erc8004AgentId = newErc8004AgentId;
        emit AgentIdRebound(listingId, oldErc8004AgentId, newErc8004AgentId);
    }

    function setActive(uint256 listingId, bool active) external onlyListingOwner(listingId) {
        _listings[listingId].active = active;
        emit ActiveChanged(listingId, active);
    }

    /// @notice Point ownership checks at the ERC-8004 IdentityRegistry.
    /// @dev Zero and code-less addresses are refused: once the check is on it can be
    ///      redirected but not switched off by a typo, and a code-less target would make
    ///      every `ownerOf` call revert outside the `try` (Solidity checks extcodesize
    ///      before the call), turning `list()` into an unexplained revert for everyone.
    function setIdentityRegistry(address identityRegistry_) external onlyOwner {
        if (identityRegistry_.code.length == 0) revert InvalidIdentityRegistry(identityRegistry_);
        identityRegistry = identityRegistry_;
        emit IdentityRegistryChanged(identityRegistry_);
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

    /// @dev Reverts with `NotAgentIdentityOwner` unless `msg.sender` owns `erc8004AgentId`
    ///      in `identityRegistry`. A nonexistent id makes the ERC-721 `ownerOf` revert;
    ///      that is caught and reported as the same error with `identityOwner = 0`.
    ///      Callers check that `identityRegistry` is set first.
    function _requireIdentityOwner(uint256 erc8004AgentId) internal view {
        address identityOwner;
        try IERC721(identityRegistry).ownerOf(erc8004AgentId) returns (address o) {
            identityOwner = o;
        } catch {
            revert NotAgentIdentityOwner(erc8004AgentId, msg.sender, address(0));
        }
        if (identityOwner != msg.sender) revert NotAgentIdentityOwner(erc8004AgentId, msg.sender, identityOwner);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
