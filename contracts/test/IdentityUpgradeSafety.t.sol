// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";
import {FuguRegistryPreIdentity} from "./legacy/FuguRegistryPreIdentity.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @title IdentityUpgradeSafetyTest
/// @notice Proves that upgrading the live `FuguRegistry` proxy to the version that checks
///         ERC-8004 ownership leaves all nine existing listings exactly as they are, and
///         that `rebindAgentId` then moves each one onto a real identity without
///         disturbing anything else — subscriptions included.
///
/// @dev Written the same hard way as `CategoryUpgradeSafety.t.sol`, for the same reason:
///      the listings that matter were written by the implementation at
///      `0x13836c1bc0d32def6b6c0ec2acf120c2f342f3eb`, not by today's code. So every test
///      here seeds a proxy over `FuguRegistryPreIdentity` (a frozen copy of that source,
///      whose bytecode matches the deployed one apart from the metadata hash), upgrades,
///      and compares.
///
///      The seed mirrors BSC testnet as read on 2026-09-25: listing ids 1..9, placeholder
///      ids 8004..8012, one per category in the order they were listed, the deployer EOA
///      as owner of all nine, Guardian at $0.10 and the rest at $0.05 per 120 s.
///
///      "Byte-for-byte" is literal: each listing is compared as `keccak256(abi.encode(...))`
///      of the whole struct, so a shifted field or a truncated string fails even if every
///      field-level assertion someone thought to write happens to pass.
contract IdentityUpgradeSafetyTest is Test {
    uint256 constant N = 9;
    uint256 constant FIRST_PLACEHOLDER = 8004;

    /// @dev The storage slot `identityRegistry` must occupy: right after
    ///      `listingByAgentId` (slot 4). A literal, so a reordering in `src/` fails here.
    uint256 constant IDENTITY_REGISTRY_SLOT = 5;

    address owner = address(0xA11CE);
    address deployer = 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E;
    address user = address(0x5E1);
    address treasury = address(0x7EA);

    address proxy;
    FuguRegistryPreIdentity legacy;
    MockIdentityRegistry identity;

    function setUp() public {
        proxy = address(
            new ERC1967Proxy(
                address(new FuguRegistryPreIdentity()), abi.encodeCall(FuguRegistryPreIdentity.initialize, (owner))
            )
        );
        legacy = FuguRegistryPreIdentity(proxy);
        identity = new MockIdentityRegistry();
    }

    /// @dev The nine live listings, in listing order. Wallets are the on-chain
    ///      `agentWallet` values (Guardian's is the deployer EOA, as it is live).
    function _seed() internal returns (bytes32[N] memory hashes) {
        Category[N] memory cats = [
            Category.HEALTH_FACTOR,
            Category.REBALANCING,
            Category.GRID,
            Category.YIELD,
            Category.HIRING,
            Category.COMMERCE,
            Category.AUTONOMOUS,
            Category.STREAMING,
            Category.TREASURY
        ];
        address[N] memory wallets = [
            deployer,
            0xb8f155D1278f0437b9De7c63911f2C0EDa485941,
            0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9,
            0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866,
            0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3,
            0x1B82F72346a8553a968fafD6AC07A21d4A88589f,
            0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D,
            0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8,
            0xB92Dd50E84560E719627AcE28b32060dbF0E7083
        ];
        vm.startPrank(deployer);
        for (uint256 i = 0; i < N; ++i) {
            uint256 id = legacy.list(
                FIRST_PLACEHOLDER + i,
                wallets[i],
                cats[i],
                i == 0 ? 10_000_000 : 5_000_000,
                120,
                string.concat("data:application/json;base64,listing-", vm.toString(i + 1))
            );
            assertEq(id, i + 1, "seed listing id");
        }
        vm.stopPrank();

        for (uint256 i = 0; i < N; ++i) {
            hashes[i] = keccak256(abi.encode(legacy.getListing(i + 1)));
        }
    }

    function _upgrade() internal returns (FuguRegistry) {
        address newImpl = address(new FuguRegistry());
        vm.prank(owner);
        legacy.upgradeToAndCall(newImpl, "");
        return FuguRegistry(proxy);
    }

    function _enable(FuguRegistry r) internal {
        vm.prank(owner);
        r.setIdentityRegistry(address(identity));
    }

    /// @dev Mints one identity per listing to the deployer, starting at `firstId` so the
    ///      test stands where the live registry stands (~2476 next).
    function _mintAll(uint256 firstId) internal returns (uint256[N] memory ids) {
        identity.skipTo(firstId);
        for (uint256 i = 0; i < N; ++i) {
            vm.prank(deployer);
            ids[i] = identity.register(string.concat("data:application/json;base64,agent-", vm.toString(i + 1)));
        }
    }

    // -----------------------------------------------------------------------------
    // The upgrade itself
    // -----------------------------------------------------------------------------

    /// @notice All nine listings read back byte-for-byte identical after the upgrade.
    function test_everyListingIdenticalAfterUpgrade() public {
        bytes32[N] memory before = _seed();
        FuguRegistry upgraded = _upgrade();

        for (uint256 i = 0; i < N; ++i) {
            assertEq(keccak256(abi.encode(upgraded.getListing(i + 1))), before[i], "listing changed across upgrade");
            assertEq(upgraded.listingByAgentId(FIRST_PLACEHOLDER + i), i + 1, "mapping changed across upgrade");
        }
        assertEq(upgraded.listingCount(), N);
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            assertEq(upgraded.countByCategory(Category(c)), 1);
        }
        assertTrue(upgraded.isCurator(deployer) == legacy.isCurator(deployer));
    }

    /// @notice The new variable lands in slot 5 and reads zero on an upgraded proxy, so
    ///         the upgrade by itself switches nothing on.
    function test_identityRegistryIsAppendedAtSlot5AndStartsZero() public {
        _seed();
        FuguRegistry upgraded = _upgrade();

        assertEq(upgraded.identityRegistry(), address(0));
        assertEq(vm.load(proxy, bytes32(IDENTITY_REGISTRY_SLOT)), bytes32(0));

        _enable(upgraded);
        assertEq(
            vm.load(proxy, bytes32(IDENTITY_REGISTRY_SLOT)),
            bytes32(uint256(uint160(address(identity)))),
            "identityRegistry is not in slot 5"
        );
        // and writing it disturbed no listing
        assertEq(upgraded.getListing(1).erc8004AgentId, FIRST_PLACEHOLDER);
    }

    /// @notice Between the upgrade and `setIdentityRegistry`, `list()` behaves as before.
    function test_listUnchangedUntilConfigured() public {
        _seed();
        FuguRegistry upgraded = _upgrade();

        vm.prank(user);
        uint256 id = upgraded.list(9999, address(0x1), Category.GRID, 5_000_000, 120, "x");
        assertEq(id, N + 1);
    }

    /// @notice Once configured, the placeholder ids the live listings hold could not be
    ///         listed today — which is the whole reason they have to be rebound.
    function test_placeholderIdsWouldBeRefusedOnceConfigured() public {
        _seed();
        FuguRegistry upgraded = _upgrade();
        _enable(upgraded);

        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(FuguRegistry.NotAgentIdentityOwner.selector, uint256(8013), user, address(0))
        );
        upgraded.list(8013, address(0x1), Category.GRID, 5_000_000, 120, "x");
    }

    // -----------------------------------------------------------------------------
    // Rebinding all nine
    // -----------------------------------------------------------------------------

    /// @notice The migration as the scripts run it: every listing moves onto a freshly
    ///         minted identity, and nothing but `erc8004AgentId` changes on any of them.
    function test_rebindAllNineKeepsEverythingButTheId() public {
        bytes32[N] memory before = _seed();
        FuguRegistry upgraded = _upgrade();
        _enable(upgraded);
        uint256[N] memory ids = _mintAll(2476);

        for (uint256 i = 0; i < N; ++i) {
            vm.expectEmit(true, true, true, true, proxy);
            emit FuguRegistry.AgentIdRebound(i + 1, FIRST_PLACEHOLDER + i, ids[i]);
            vm.prank(deployer);
            upgraded.rebindAgentId(i + 1, ids[i]);
        }

        for (uint256 i = 0; i < N; ++i) {
            Listing memory l = upgraded.getListing(i + 1);
            assertEq(l.erc8004AgentId, ids[i]);

            // Put the old id back and the struct must hash to exactly what it was.
            l.erc8004AgentId = FIRST_PLACEHOLDER + i;
            assertEq(keccak256(abi.encode(l)), before[i], "a field other than erc8004AgentId moved");

            assertEq(upgraded.listingByAgentId(ids[i]), i + 1);
            assertEq(upgraded.listingByAgentId(FIRST_PLACEHOLDER + i), 0, "placeholder not released");
        }
        assertEq(upgraded.listingCount(), N);
        for (uint8 c = 0; c <= uint8(Category.TREASURY); ++c) {
            assertEq(upgraded.countByCategory(Category(c)), 1);
        }
    }

    /// @notice A subscription opened before the upgrade keeps accruing and pays out to
    ///         the same owner after the listing is rebound. `FuguSubscription` keys
    ///         everything by listing id, which the rebind never touches.
    function test_subscriptionSurvivesUpgradeAndRebind() public {
        vm.warp(1_700_000_000);
        _seed();

        FuguPriceOracle oracle = FuguPriceOracle(
            address(new ERC1967Proxy(address(new FuguPriceOracle()), abi.encodeCall(FuguPriceOracle.initialize, (owner))))
        );
        FuguSubscription subs = FuguSubscription(
            payable(address(new ERC1967Proxy(
                address(new FuguSubscription()),
                abi.encodeCall(FuguSubscription.initialize, (owner, proxy, address(oracle), treasury, 500))
            )))
        );
        MockERC20 usdt = new MockERC20("Tether", "USDT");
        MockAggregator feed = new MockAggregator(8, 1_00000000);
        vm.prank(owner);
        oracle.setToken(
            address(usdt),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(feed),
                maxStaleness: 90000,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        usdt.mint(user, 1000e18);
        vm.prank(user);
        usdt.approve(address(subs), type(uint256).max);

        // Guardian: $0.10 per 120 s, one period = 0.1 USDT
        vm.prank(user);
        uint256 subId = subs.subscribe(1, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        FuguRegistry upgraded = _upgrade();
        _enable(upgraded);
        uint256[N] memory ids = _mintAll(2476);
        vm.prank(deployer);
        upgraded.rebindAgentId(1, ids[0]);

        vm.warp(block.timestamp + 120);
        assertEq(subs.getSub(subId).listingId, 1);
        assertEq(subs.claimable(subId), 0.1e18);

        uint256 ownerBefore = usdt.balanceOf(deployer);
        subs.claim(subId);
        uint256 fee = (0.1e18 * 500) / 10_000;
        assertEq(usdt.balanceOf(deployer), ownerBefore + 0.1e18 - fee, "payout did not reach the listing owner");
        assertTrue(subs.hasSubscribed(1, user));
    }

    /// @notice Once rebound, a third party who later holds 8004 for real can list it: the
    ///         collision the placeholders would have caused is gone.
    function test_placeholderFreedForItsRealOwner() public {
        _seed();
        FuguRegistry upgraded = _upgrade();
        _enable(upgraded);
        uint256[N] memory ids = _mintAll(2476);
        vm.prank(deployer);
        upgraded.rebindAgentId(1, ids[0]);

        identity.skipTo(8004);
        address builder = address(0xB111D);
        vm.prank(builder);
        assertEq(identity.register("theirs"), 8004);

        vm.prank(builder);
        uint256 theirs = upgraded.list(8004, address(0xB111D), Category.HEALTH_FACTOR, 1_000_000, 60, "theirs");
        assertEq(upgraded.listingByAgentId(8004), theirs);
        assertEq(upgraded.getListing(1).erc8004AgentId, ids[0]);
    }

    /// @notice A placeholder that has NOT been rebound yet still blocks its id — so the
    ///         migration must finish before the IdentityRegistry reaches 8004, or the real
    ///         owner of that id is locked out until it does.
    function test_unreboundPlaceholderStillBlocksItsRealOwner() public {
        _seed();
        FuguRegistry upgraded = _upgrade();
        _enable(upgraded);

        identity.skipTo(8005);
        address builder = address(0xB111D);
        vm.prank(builder);
        identity.register("theirs");

        vm.prank(builder);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.AgentAlreadyListed.selector, uint256(8005), uint256(2)));
        upgraded.list(8005, address(0xB111D), Category.REBALANCING, 1_000_000, 60, "theirs");
    }
}
