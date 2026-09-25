// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {RegisterErc8004Identities} from "../script/RegisterErc8004Identities.s.sol";
import {RebindAgentIds} from "../script/RebindAgentIds.s.sol";
import {Erc8004Plan, IErc8004IdentityRegistry} from "../script/Erc8004Plan.sol";
import {PlainSummaries} from "../script/PlainSummaries.s.sol";
import {ListAgents} from "../script/ListAgents.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";
import {FuguRegistryPreIdentity} from "./legacy/FuguRegistryPreIdentity.sol";
import {MockIdentityRegistry} from "./mocks/MockIdentityRegistry.sol";

/// @dev Exposes phase 1's internals so the exact path that will run on testnet runs here
///      first. The harness is the sender: it owns the listings and receives the tokens,
///      which is the shape the deployer EOA has on chain.
contract RegisterHarness is RegisterErc8004Identities {
    function registerAll(FuguRegistry registry, IErc8004IdentityRegistry identity, uint256[] memory given)
        external
        returns (uint256[9] memory)
    {
        return _registerAll(registry, identity, address(this), given);
    }

    function agent(uint256 i) external pure returns (Agent memory) {
        return _agents()[i];
    }

    function draftURI(uint256 i) external pure returns (string memory) {
        return _draftURI(_agents()[i]);
    }

    function finalURI(uint256 i, uint256 agentId) external pure returns (string memory) {
        return _finalURI(_agents()[i], agentId);
    }

    function draftJson(uint256 i) external pure returns (string memory) {
        return _registrationJson(_agents()[i], "[]");
    }
}

/// @dev Phase 2's internals, with the identity registry injectable so it can be a mock.
contract RebindHarness is RebindAgentIds {
    function upgradeIfNeeded(FuguRegistry registry) external {
        _upgradeIfNeeded(registry);
    }

    function configureIfNeeded(FuguRegistry registry, address identity) external {
        _configureIfNeeded(registry, identity);
    }

    function rebindAll(FuguRegistry registry, IErc8004IdentityRegistry identity, uint256[] memory ids) external {
        _rebindAll(registry, identity, address(this), ids);
    }

    function snapshot(FuguRegistry registry) external view returns (Listing[9] memory) {
        return _snapshot(registry);
    }

    function verifyAll(
        FuguRegistry registry,
        IErc8004IdentityRegistry identity,
        uint256[] memory ids,
        Listing[9] memory before
    ) external view {
        _verifyAll(registry, identity, ids, before);
    }

    function draftURI(uint256 i) external pure returns (string memory) {
        return _draftURI(_agents()[i]);
    }

    function finalURI(uint256 i, uint256 agentId) external pure returns (string memory) {
        return _finalURI(_agents()[i], agentId);
    }

    /// @dev Lets the test hand ownership of the frozen proxy's listings to this harness.
    function list(FuguRegistryPreIdentity legacy, uint256 agentId, address wallet, Category c, uint128 price)
        external
        returns (uint256)
    {
        return legacy.list(agentId, wallet, c, price, 120, string.concat("meta-", vm.toString(agentId)));
    }

    function register(IErc8004IdentityRegistry identity, string memory uri) external returns (uint256) {
        return identity.register(uri);
    }
}

contract PlainSummariesTextHarness is PlainSummaries {
    function summary(uint256 i) external pure returns (string memory) {
        return _rewrites()[i].summary;
    }

    function name(uint256 i) external pure returns (string memory) {
        return _rewrites()[i].name;
    }
}

contract ListAgentsTextHarness is ListAgents {
    function plan() external pure returns (AgentPlan[8] memory) {
        return _plan();
    }
}

/// @notice The two migration scripts, run against a frozen copy of the live registry and
///         a mock IdentityRegistry: the registration files are valid ERC-8004 JSON that
///         says what the listings say, both phases are idempotent, and neither will bind
///         an identity to the wrong listing.
contract Erc8004MigrationScriptsTest is Test {
    uint256 constant N = 9;
    Category[9] CATS = [
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

    bytes32 constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address registryOwner = address(0xA11CE);
    MockIdentityRegistry identity;

    function setUp() public {
        identity = new MockIdentityRegistry();
        identity.skipTo(2476); // where the live registry stands on 2026-09-25
    }

    /// @dev A proxy over the frozen live implementation, with listings 1..9 on
    ///      placeholders 8004..8012, all owned by `lister`.
    function _seedLegacy(address lister, address proxyOwner) internal returns (address proxy) {
        proxy = address(
            new ERC1967Proxy(
                address(new FuguRegistryPreIdentity()), abi.encodeCall(FuguRegistryPreIdentity.initialize, (proxyOwner))
            )
        );
        for (uint256 i = 0; i < N; ++i) {
            vm.prank(lister);
            FuguRegistryPreIdentity(proxy).list(
                8004 + i, address(uint160(0xA000 + i)), CATS[i], i == 0 ? 10_000_000 : 5_000_000, 120, "meta"
            );
        }
    }

    function _none() internal pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function _toDyn(uint256[9] memory a) internal pure returns (uint256[] memory d) {
        d = new uint256[](9);
        for (uint256 i = 0; i < 9; ++i) d[i] = a[i];
    }

    // -----------------------------------------------------------------------------
    // The registration files
    // -----------------------------------------------------------------------------

    /// @notice Every draft parses as JSON and carries the ERC-8004 `type`, the agent's
    ///         name, and an empty `registrations`.
    function test_draftFilesAreValidRegistrationJson() public {
        RegisterHarness h = new RegisterHarness();
        for (uint256 i = 0; i < N; ++i) {
            string memory json = h.draftJson(i);
            assertEq(vm.parseJsonString(json, ".type"), "https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
            assertEq(vm.parseJsonString(json, ".name"), h.agent(i).name);
            assertEq(vm.parseJsonUint(json, ".fuguListing.listingId"), i + 1);
            assertTrue(vm.parseJsonBool(json, ".active"));
            assertEq(abi.decode(vm.parseJson(json, ".registrations"), (bytes[])).length, 0, "draft names an id");
        }
    }

    /// @notice The final file names its own id in the canonical registry on chain 97.
    function test_finalFileNamesItsOwnId() public {
        RegisterHarness h = new RegisterHarness();
        string memory uri = h.finalURI(0, 2476);
        string memory json = string(_decodeDataURI(uri));
        assertEq(vm.parseJsonUint(json, ".registrations[0].agentId"), 2476);
        assertEq(
            vm.parseJsonString(json, ".registrations[0].agentRegistry"),
            "eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e"
        );
    }

    /// @notice Guardian is the only agent with an A2A endpoint, and it is the live card.
    function test_onlyGuardianAdvertisesA2A() public {
        RegisterHarness h = new RegisterHarness();
        string memory guardian = h.draftJson(0);
        assertEq(vm.parseJsonString(guardian, ".services[1].name"), "A2A");
        assertEq(
            vm.parseJsonString(guardian, ".services[1].endpoint"),
            "https://agents.hellofugu.xyz/guardian/.well-known/agent-card.json"
        );
        for (uint256 i = 1; i < N; ++i) {
            string memory json = h.draftJson(i);
            assertEq(vm.parseJsonString(json, ".services[1].name"), "agentWallet", "non-Guardian advertises A2A");
            assertFalse(vm.keyExistsJson(json, ".services[2]"));
        }
    }

    /// @notice The five agents without their own art get no image rather than a borrowed one.
    function test_imageOnlyWhereTheAgentHasArt() public {
        RegisterHarness h = new RegisterHarness();
        for (uint256 i = 0; i < N; ++i) {
            assertEq(vm.keyExistsJson(h.draftJson(i), ".image"), i < 4);
        }
    }

    /// @notice Names and summaries are copies of what the listing scripts wrote, so the
    ///         identity and the marketplace card cannot drift apart unnoticed.
    function test_textMatchesTheListingScripts() public {
        RegisterHarness h = new RegisterHarness();
        PlainSummariesTextHarness plain = new PlainSummariesTextHarness();
        ListAgentsTextHarness listAgents = new ListAgentsTextHarness();

        for (uint256 i = 0; i < 4; ++i) {
            assertEq(h.agent(i).name, plain.name(i));
            assertEq(h.agent(i).summary, plain.summary(i));
        }
        // ListAgents' plan is listings 2..9; its first three summaries were later
        // rewritten by PlainSummaries (checked above), the last five are still its own.
        ListAgents.AgentPlan[8] memory plan = listAgents.plan();
        for (uint256 i = 4; i < N; ++i) {
            assertEq(h.agent(i).name, plan[i - 1].name);
            assertEq(h.agent(i).summary, plan[i - 1].summary);
            assertEq(h.agent(i).wallet, plan[i - 1].agentWallet);
        }
    }

    // -----------------------------------------------------------------------------
    // Phase 1: RegisterErc8004Identities
    // -----------------------------------------------------------------------------

    function test_registerMintsNineDraftIdentities() public {
        RegisterHarness h = new RegisterHarness();
        FuguRegistry registry = FuguRegistry(_seedLegacy(address(h), registryOwner));

        uint256[9] memory ids = h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _none());

        for (uint256 i = 0; i < N; ++i) {
            assertEq(ids[i], 2476 + i);
            assertEq(identity.ownerOf(ids[i]), address(h));
            assertEq(identity.tokenURI(ids[i]), h.draftURI(i));
        }
        assertEq(identity.balanceOf(address(h)), N);
    }

    /// @notice A second run told about the first run's ids mints nothing.
    function test_registerRerunWithAgentIdsMintsNothing() public {
        RegisterHarness h = new RegisterHarness();
        FuguRegistry registry = FuguRegistry(_seedLegacy(address(h), registryOwner));
        uint256[9] memory first = h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _none());

        uint256[9] memory second = h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _toDyn(first));

        assertEq(identity.balanceOf(address(h)), N, "minted again");
        for (uint256 i = 0; i < N; ++i) assertEq(second[i], first[i]);
    }

    /// @notice A second run NOT told about the first run's ids refuses rather than
    ///         minting nine orphans.
    function test_registerRerunWithoutAgentIdsRefuses() public {
        RegisterHarness h = new RegisterHarness();
        FuguRegistry registry = FuguRegistry(_seedLegacy(address(h), registryOwner));
        h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _none());

        vm.expectRevert(abi.encodeWithSelector(RegisterErc8004Identities.UnaccountedIdentities.selector, 9, 0));
        h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _none());
    }

    /// @notice A partial first run (broadcast died after four) resumes with the four ids
    ///         and mints only the other five.
    function test_registerResumesAfterAPartialRun() public {
        RegisterHarness h = new RegisterHarness();
        FuguRegistry registry = FuguRegistry(_seedLegacy(address(h), registryOwner));
        uint256[] memory partial_ = new uint256[](4);
        for (uint256 i = 0; i < 4; ++i) {
            // Read the URI first: `h.draftURI` is itself a call and would spend the prank.
            string memory uri = h.draftURI(i);
            vm.prank(address(h));
            partial_[i] = identity.register(uri);
        }

        uint256[9] memory ids = h.registerAll(registry, IErc8004IdentityRegistry(address(identity)), partial_);

        assertEq(identity.balanceOf(address(h)), N);
        for (uint256 i = 0; i < 4; ++i) assertEq(ids[i], partial_[i]);
        for (uint256 i = 4; i < N; ++i) assertEq(identity.tokenURI(ids[i]), h.draftURI(i));
    }

    // -----------------------------------------------------------------------------
    // Phase 2: RebindAgentIds
    // -----------------------------------------------------------------------------

    /// @dev Listings and proxy owned by the rebind harness, identities minted to it with
    ///      each listing's draft file — the state phase 1 leaves behind.
    function _phase1Done() internal returns (RebindHarness h, FuguRegistry registry, uint256[] memory ids) {
        h = new RebindHarness();
        registry = FuguRegistry(_seedLegacy(address(h), address(h)));
        ids = new uint256[](N);
        for (uint256 i = 0; i < N; ++i) {
            ids[i] = h.register(IErc8004IdentityRegistry(address(identity)), h.draftURI(i));
        }
    }

    function _phase2(RebindHarness h, FuguRegistry registry, uint256[] memory ids) internal {
        h.upgradeIfNeeded(registry);
        h.configureIfNeeded(registry, address(identity));
        h.rebindAll(registry, IErc8004IdentityRegistry(address(identity)), ids);
    }

    function test_rebindUpgradesConfiguresAndBindsAllNine() public {
        (RebindHarness h, FuguRegistry registry, uint256[] memory ids) = _phase1Done();
        Listing[9] memory before = h.snapshot(registry);

        _phase2(h, registry, ids);

        assertEq(registry.identityRegistry(), address(identity));
        h.verifyAll(registry, IErc8004IdentityRegistry(address(identity)), ids, before);
        for (uint256 i = 0; i < N; ++i) {
            assertEq(registry.getListing(i + 1).erc8004AgentId, ids[i]);
            assertEq(identity.tokenURI(ids[i]), h.finalURI(i, ids[i]));
        }
    }

    /// @notice Running phase 2 again changes nothing and does not revert.
    function test_rebindRerunIsANoOp() public {
        (RebindHarness h, FuguRegistry registry, uint256[] memory ids) = _phase1Done();
        Listing[9] memory before = h.snapshot(registry);
        _phase2(h, registry, ids);
        address implAfterFirst = address(uint160(uint256(vm.load(address(registry), IMPL_SLOT))));

        vm.recordLogs();
        _phase2(h, registry, ids);
        assertEq(vm.getRecordedLogs().length, 0, "second run wrote something");

        assertEq(address(uint160(uint256(vm.load(address(registry), IMPL_SLOT)))), implAfterFirst);
        h.verifyAll(registry, IErc8004IdentityRegistry(address(identity)), ids, before);
    }

    /// @notice Two ids swapped: the tokenURI check catches it before anything is written.
    function test_rebindRefusesShuffledIds() public {
        (RebindHarness h, FuguRegistry registry, uint256[] memory ids) = _phase1Done();
        h.upgradeIfNeeded(registry);
        h.configureIfNeeded(registry, address(identity));
        (ids[2], ids[3]) = (ids[3], ids[2]);

        vm.expectRevert(abi.encodeWithSelector(Erc8004Plan.IdentityUriMismatch.selector, uint256(3), ids[2]));
        h.rebindAll(registry, IErc8004IdentityRegistry(address(identity)), ids);
        assertEq(registry.getListing(1).erc8004AgentId, 8004, "listing 1 bound before the bad id was found");
    }

    /// @notice An id the sender does not own — e.g. taken by someone else between the
    ///         simulation and the broadcast — stops the run.
    function test_rebindRefusesAnIdSomeoneElseOwns() public {
        (RebindHarness h, FuguRegistry registry, uint256[] memory ids) = _phase1Done();
        h.upgradeIfNeeded(registry);
        h.configureIfNeeded(registry, address(identity));
        vm.prank(address(0xBAD));
        ids[4] = identity.register("theirs");

        vm.expectRevert(
            abi.encodeWithSelector(Erc8004Plan.IdentityNotOwned.selector, uint256(5), ids[4], address(0xBAD))
        );
        h.rebindAll(registry, IErc8004IdentityRegistry(address(identity)), ids);
    }

    /// @notice After phase 2, phase 1 sees all nine as done and mints nothing.
    function test_registerAfterRebindMintsNothing() public {
        (RebindHarness h, FuguRegistry registry, uint256[] memory ids) = _phase1Done();
        _phase2(h, registry, ids);

        // Hand the finished state to a phase-1 harness: same listings, same tokens.
        RegisterHarness r = new RegisterHarness();
        vm.etch(address(h), address(r).code);
        RegisterHarness asH = RegisterHarness(address(h));
        uint256[9] memory got = asH.registerAll(registry, IErc8004IdentityRegistry(address(identity)), _none());

        assertEq(identity.balanceOf(address(h)), N, "minted again");
        for (uint256 i = 0; i < N; ++i) assertEq(got[i], ids[i]);
    }

    // -----------------------------------------------------------------------------

    /// @dev `data:application/json;base64,<b64>` -> the JSON bytes. Neither forge-std nor
    ///      OpenZeppelin ships a base64 decoder, so decode by hand.
    function _decodeDataURI(string memory uri) internal pure returns (bytes memory) {
        bytes memory raw = bytes(uri);
        uint256 p = bytes("data:application/json;base64,").length;
        bytes memory d = new bytes(raw.length - p);
        for (uint256 i = 0; i < d.length; ++i) d[i] = raw[i + p];

        uint256 pad = (d[d.length - 1] == "=" ? 1 : 0) + (d[d.length - 2] == "=" ? 1 : 0);
        bytes memory out = new bytes((d.length / 4) * 3 - pad);
        uint256 o;
        for (uint256 i = 0; i < d.length; i += 4) {
            uint256 c = (_v(d[i]) << 18) | (_v(d[i + 1]) << 12) | (_v(d[i + 2]) << 6) | _v(d[i + 3]);
            if (o < out.length) out[o++] = bytes1(uint8(c >> 16));
            if (o < out.length) out[o++] = bytes1(uint8(c >> 8));
            if (o < out.length) out[o++] = bytes1(uint8(c));
        }
        return out;
    }

    function _v(bytes1 c) internal pure returns (uint256) {
        uint8 x = uint8(c);
        if (x >= 65 && x <= 90) return x - 65;
        if (x >= 97 && x <= 122) return x - 71;
        if (x >= 48 && x <= 57) return x + 4;
        if (x == 43) return 62;
        if (x == 47) return 63;
        return 0;
    }
}
