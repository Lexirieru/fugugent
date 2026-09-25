// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

/// @title AgentIdRebindTest
/// @notice `FuguRegistry` checking ERC-8004 ownership: `setIdentityRegistry`, the new gate
///         on `list()`, and `rebindAgentId`, which moves a listing off a placeholder id and
///         onto an identity the caller really holds.
///
/// @dev The identity registry is `MockIdentityRegistry`, an ERC-721 that mints from 0 the
///      way the live one does. Every revert is matched on its full encoded arguments, not
///      only its selector: `NotAgentIdentityOwner` carries WHO owns the id, and a test that
///      only checked the selector could not tell "owned by someone else" from "does not
///      exist".
contract AgentIdRebindTest is Test {
    FuguRegistry registry;
    MockIdentityRegistry identity;

    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address stranger = address(0xBAD);

    /// @dev A placeholder id of the kind listings 1..9 hold on BSC testnet: never minted.
    uint256 constant PLACEHOLDER = 8004;

    function setUp() public {
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(new FuguRegistry()), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );
        identity = new MockIdentityRegistry();
    }

    function _enableIdentityCheck() internal {
        vm.prank(owner);
        registry.setIdentityRegistry(address(identity));
    }

    function _mintTo(address to) internal returns (uint256 agentId) {
        vm.prank(to);
        agentId = identity.register("data:application/json;base64,e30=");
    }

    /// @dev A listing on a placeholder id, created while the check is still off — the
    ///      state the live listings are in.
    function _placeholderListing() internal returns (uint256 listingId) {
        vm.prank(creator);
        listingId = registry.list(PLACEHOLDER, address(0xA6E17), Category.HEALTH_FACTOR, 10_000_000, 120, "meta");
    }

    // -----------------------------------------------------------------------------
    // setIdentityRegistry
    // -----------------------------------------------------------------------------

    function test_identityRegistryStartsUnset() public view {
        assertEq(registry.identityRegistry(), address(0));
    }

    function test_ownerSetsIdentityRegistryAndItIsEmitted() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit FuguRegistry.IdentityRegistryChanged(address(identity));
        _enableIdentityCheck();
        assertEq(registry.identityRegistry(), address(identity));
    }

    function test_onlyOwnerSetsIdentityRegistry() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setIdentityRegistry(address(identity));
    }

    /// @notice Zero would switch the check back off; an EOA would make every `list()`
    ///         revert with no reason. Both are refused.
    function test_setIdentityRegistryRejectsZeroAndCodelessAddresses() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.InvalidIdentityRegistry.selector, address(0)));
        registry.setIdentityRegistry(address(0));
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.InvalidIdentityRegistry.selector, stranger));
        registry.setIdentityRegistry(stranger);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------------
    // list() with and without the check
    // -----------------------------------------------------------------------------

    /// @notice Before the owner turns the check on, `list()` behaves exactly as it did:
    ///         an id nobody minted is accepted. This is what keeps the upgrade itself from
    ///         changing anything until `setIdentityRegistry` runs.
    function test_listStillPermissionlessWhileUnconfigured() public {
        uint256 id = _placeholderListing();
        assertEq(registry.getListing(id).erc8004AgentId, PLACEHOLDER);
    }

    function test_listAcceptsAnIdTheCallerOwns() public {
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);

        vm.prank(creator);
        uint256 id = registry.list(agentId, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");

        assertEq(registry.getListing(id).erc8004AgentId, agentId);
        assertEq(registry.listingByAgentId(agentId), id);
    }

    /// @notice The IdentityRegistry mints from 0, so id 0 is a real identity and must
    ///         list like any other — `listingByAgentId` uses 0 only as a VALUE for
    ///         "unclaimed", never as a key that is off limits.
    function test_listAcceptsAgentIdZero() public {
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);
        assertEq(agentId, 0);

        vm.prank(creator);
        uint256 id = registry.list(0, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");
        assertEq(registry.listingByAgentId(0), id);
    }

    /// @notice The quest case: a third party cannot list an identity that belongs to
    ///         somebody else.
    function test_listRejectsAnIdOwnedBySomeoneElse() public {
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(FuguRegistry.NotAgentIdentityOwner.selector, agentId, stranger, creator)
        );
        registry.list(agentId, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");
    }

    /// @notice An id nobody minted makes the ERC-721 `ownerOf` revert. That surfaces as
    ///         OUR error, with the owner reported as zero, not as `ERC721NonexistentToken`
    ///         from a contract the caller never called.
    function test_listRejectsANonexistentIdWithTheSameError() public {
        _enableIdentityCheck();

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(FuguRegistry.NotAgentIdentityOwner.selector, PLACEHOLDER, creator, address(0))
        );
        registry.list(PLACEHOLDER, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");
    }

    // -----------------------------------------------------------------------------
    // rebindAgentId — the path that works
    // -----------------------------------------------------------------------------

    /// @notice Only `erc8004AgentId` moves. Everything a subscriber or the marketplace
    ///         relies on stays byte-for-byte what it was.
    function test_rebindChangesOnlyTheAgentId() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        Listing memory before = registry.getListing(listingId);

        uint256 agentId = _mintTo(creator);
        vm.prank(creator);
        registry.rebindAgentId(listingId, agentId);

        Listing memory afterL = registry.getListing(listingId);
        assertEq(afterL.erc8004AgentId, agentId);
        assertEq(afterL.owner, before.owner);
        assertEq(afterL.agentWallet, before.agentWallet);
        assertEq(uint8(afterL.category), uint8(before.category));
        assertEq(afterL.priceUsd8PerPeriod, before.priceUsd8PerPeriod);
        assertEq(afterL.periodSeconds, before.periodSeconds);
        assertEq(afterL.active, before.active);
        assertEq(afterL.curated, before.curated);
        assertEq(afterL.metadataURI, before.metadataURI);

        assertEq(registry.listingCount(), 1);
        assertEq(registry.countByCategory(Category.HEALTH_FACTOR), 1);
    }

    function test_rebindEmitsAgentIdRebound() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);

        vm.expectEmit(true, true, true, true, address(registry));
        emit FuguRegistry.AgentIdRebound(listingId, PLACEHOLDER, agentId);
        vm.prank(creator);
        registry.rebindAgentId(listingId, agentId);
    }

    /// @notice The placeholder is released, and the new id points at the listing.
    function test_rebindMovesTheMapping() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);

        vm.prank(creator);
        registry.rebindAgentId(listingId, agentId);

        assertEq(registry.listingByAgentId(PLACEHOLDER), 0, "old id still mapped");
        assertEq(registry.listingByAgentId(agentId), listingId, "new id not mapped");
    }

    /// @notice The reason the old entry has to be cleared: once the IdentityRegistry grows
    ///         past 8004, whoever really owns 8004 must be able to list it here.
    function test_realOwnerOfAFormerPlaceholderCanListItAfterRebind() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 ours = _mintTo(creator);
        vm.prank(creator);
        registry.rebindAgentId(listingId, ours);

        identity.skipTo(PLACEHOLDER);
        uint256 theirs = _mintTo(stranger);
        assertEq(theirs, PLACEHOLDER);

        vm.prank(stranger);
        uint256 theirListing = registry.list(PLACEHOLDER, address(0xB0B), Category.GRID, 5_000_000, 120, "theirs");
        assertEq(registry.listingByAgentId(PLACEHOLDER), theirListing);
        assertEq(registry.getListing(listingId).erc8004AgentId, ours, "our listing moved");
    }

    /// @notice A listing already on a real id can move again, and each move releases the
    ///         id it left.
    function test_rebindTwiceReleasesEachPreviousId() public {
        _enableIdentityCheck();
        uint256 first = _mintTo(creator);
        uint256 second = _mintTo(creator);
        vm.prank(creator);
        uint256 listingId = registry.list(first, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");

        vm.prank(creator);
        registry.rebindAgentId(listingId, second);

        assertEq(registry.listingByAgentId(first), 0);
        assertEq(registry.listingByAgentId(second), listingId);
    }

    // -----------------------------------------------------------------------------
    // rebindAgentId — every refusal
    // -----------------------------------------------------------------------------

    function test_rebindRejectsANonListingOwner() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(stranger);

        // stranger owns the identity but not the listing
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.NotListingOwner.selector, listingId));
        registry.rebindAgentId(listingId, agentId);
    }

    function test_rebindRejectsAnUnknownListing() public {
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.ListingNotFound.selector, uint256(99)));
        registry.rebindAgentId(99, agentId);
    }

    function test_rebindRejectsAnIdentityOwnedBySomeoneElse() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(stranger);

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(FuguRegistry.NotAgentIdentityOwner.selector, agentId, creator, stranger)
        );
        registry.rebindAgentId(listingId, agentId);
    }

    function test_rebindRejectsANonexistentIdentity() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();

        vm.prank(creator);
        vm.expectRevert(
            abi.encodeWithSelector(FuguRegistry.NotAgentIdentityOwner.selector, uint256(4242), creator, address(0))
        );
        registry.rebindAgentId(listingId, 4242);
    }

    /// @notice An id another listing already holds cannot be taken over, even by someone
    ///         who owns the identity token.
    function test_rebindRejectsAnIdAlreadyListedElsewhere() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);
        vm.prank(creator);
        uint256 other = registry.list(agentId, address(0xA6E17), Category.GRID, 5_000_000, 120, "other");

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.AgentAlreadyListed.selector, agentId, other));
        registry.rebindAgentId(listingId, agentId);
    }

    /// @notice Rebinding a listing onto the id it already holds is refused rather than
    ///         treated as a no-op: the mapping says that id is taken, and the caller
    ///         should learn nothing happened instead of paying for a silent success.
    function test_rebindRejectsTheIdTheListingAlreadyHolds() public {
        _enableIdentityCheck();
        uint256 agentId = _mintTo(creator);
        vm.prank(creator);
        uint256 listingId = registry.list(agentId, address(0xA6E17), Category.GRID, 5_000_000, 120, "meta");

        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.AgentAlreadyListed.selector, agentId, listingId));
        registry.rebindAgentId(listingId, agentId);
    }

    /// @notice With no identity registry there is nothing to check ownership against, and
    ///         a rebind without that check would be a way to squat an id after the fact.
    function test_rebindRefusedWhileIdentityRegistryUnset() public {
        uint256 listingId = _placeholderListing();
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.IdentityRegistryNotSet.selector);
        registry.rebindAgentId(listingId, 1);
    }

    /// @notice A failed rebind leaves both mapping entries and the listing as they were.
    function test_failedRebindChangesNothing() public {
        uint256 listingId = _placeholderListing();
        _enableIdentityCheck();
        uint256 agentId = _mintTo(stranger);

        vm.prank(creator);
        vm.expectRevert();
        registry.rebindAgentId(listingId, agentId);

        assertEq(registry.listingByAgentId(PLACEHOLDER), listingId);
        assertEq(registry.listingByAgentId(agentId), 0);
        assertEq(registry.getListing(listingId).erc8004AgentId, PLACEHOLDER);
    }
}
