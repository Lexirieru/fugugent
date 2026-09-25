// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Listing} from "../src/types/FuguTypes.sol";
import {Erc8004Plan, IErc8004IdentityRegistry} from "./Erc8004Plan.sol";

/// @title RebindAgentIds
/// @notice Phase 2 of 2: move listings 1..9 off their placeholder ids (8004..8012) and
///         onto the ERC-8004 identities `RegisterErc8004Identities.s.sol` minted.
///
///         Four steps, each skipped when already done:
///           A. upgrade the FuguRegistry proxy to the implementation that has
///              `rebindAgentId` and the ownership check (skipped when the proxy already
///              answers `identityRegistry()`);
///           B. `setIdentityRegistry(0x8004A818...)` (skipped when already set);
///           C. per listing, rewrite the identity's draft registration file to the final
///              one that names its own id (`setAgentURI`, skipped when already final);
///           D. per listing, `rebindAgentId(listingId, newId)` (skipped when already bound).
///
///         From step B onward `list()` refuses anyone who does not own the identity they
///         list — which is what lets third-party builders list their own agents here
///         without anyone else being able to list them first.
///
/// @dev Usage — ALWAYS simulate first, without `--broadcast`, and read the output:
///
///      ```
///      cd contracts
///      AGENT_IDS=<the line phase 1 printed> forge script script/RebindAgentIds.s.sol:RebindAgentIds \
///        --rpc-url "$BSC_TESTNET_RPC_URL" --sender 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E
///      AGENT_IDS=<same> forge script script/RebindAgentIds.s.sol:RebindAgentIds \
///        --rpc-url "$BSC_TESTNET_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
///      ```
///
///      ## Why the ids are passed in rather than found
///
///      The IdentityRegistry is not enumerable, so "the deployer's tokens" cannot be read
///      back from it. Scanning ids would work but reads thousands of slots. Instead the
///      ids come from phase 1's output, and each one is checked before use: the deployer
///      must own it and its `tokenURI` must be exactly that listing's draft or final
///      registration file. A shuffled list therefore stops the run instead of binding
///      Grid's listing to Yield's identity.
///
///      ## What the upgrade can and cannot change
///
///      `identityRegistry` is appended at slot 5, after `listingByAgentId`; slots 0..4
///      are untouched (`test/IdentityUpgradeSafety.t.sol` upgrades a frozen copy of the
///      live implementation and compares all nine listings byte for byte). The rebind
///      changes `erc8004AgentId` and the `listingByAgentId` entries only; the script
///      re-reads every other field of every listing afterwards and reverts if one moved.
///
///      ## Before the IdentityRegistry reaches id 8004
///
///      Until a listing is rebound, its placeholder still occupies `listingByAgentId`, so
///      the real owner of that id could not list it. Nothing breaks today (the registry is
///      at ~2475), but this phase should not be left half-run.
///
///      `chainId` is hardcoded to 97 (BSC testnet). **Change it for mainnet.**
contract RebindAgentIds is Erc8004Plan {
    /// @dev EIP-1967 implementation slot.
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    error AgentIdsRequired(uint256 expected, uint256 given);
    error NotRegistryOwner(address owner, address sender);
    error MissingAgentId(uint256 listingId);
    error ListingFieldMoved(uint256 listingId, string field);
    error NotRebound(uint256 listingId, uint256 expected, uint256 actual);
    error PlaceholderNotReleased(uint256 listingId, uint256 placeholder);
    error UriNotFinal(uint256 listingId, uint256 agentId);
    error WrongProxiableUUID(address newImpl, bytes32 got);
    error UpgradeDidNotTakeEffect(address expected, address actual);

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);
        if (IDENTITY_REGISTRY.code.length == 0) revert NoCode("IDENTITY_REGISTRY", IDENTITY_REGISTRY);
        if (msg.sender != DEPLOYER) revert WrongSender(DEPLOYER, msg.sender);

        uint256[] memory ids = _agentIdsFromEnv();
        if (ids.length != N) revert AgentIdsRequired(N, ids.length);

        FuguRegistry registry = FuguRegistry(REGISTRY);
        IErc8004IdentityRegistry identity = IErc8004IdentityRegistry(IDENTITY_REGISTRY);
        address owner = registry.owner();
        if (owner != msg.sender) revert NotRegistryOwner(owner, msg.sender);

        console.log("== Context (verify before broadcasting) ==");
        console.log("chainId                ", block.chainid);
        console.log("FuguRegistry (proxy)   ", REGISTRY);
        console.log("implementation now     ", _implementation());
        console.log("IdentityRegistry       ", IDENTITY_REGISTRY);
        console.log("sender (registry owner)", msg.sender);
        console.log("sender balance (wei)   ", msg.sender.balance);

        // Snapshot every listing BEFORE anything is sent, through the ABI both the old and
        // the new implementation share.
        Listing[N] memory before = _snapshot(registry);

        vm.startBroadcast(msg.sender);
        _upgradeIfNeeded(registry);
        _configureIfNeeded(registry);
        _rebindAll(registry, identity, msg.sender, ids);
        vm.stopBroadcast();

        _verifyAll(registry, identity, ids, before);
        _logResult(registry, identity);
    }

    function _snapshot(FuguRegistry registry) internal view returns (Listing[N] memory s) {
        for (uint256 i = 0; i < N; ++i) {
            s[i] = registry.getListing(i + 1);
        }
    }

    // -----------------------------------------------------------------------------
    // A. upgrade
    // -----------------------------------------------------------------------------

    /// @dev The probe is `identityRegistry()`: the implementation live on 2026-09-25 has no
    ///      such function, so the static call fails there and succeeds on any version that
    ///      has the ownership check.
    function _upgradeIfNeeded(FuguRegistry registry) internal {
        if (_hasIdentitySupport(registry)) {
            console.log("A. upgrade: skipped, proxy already answers identityRegistry()");
            return;
        }
        FuguRegistry impl = new FuguRegistry();
        // Same ERC-1822 check as `Upgrade.s.sol`: an implementation that does not answer
        // with the EIP-1967 slot would brick the proxy.
        bytes32 uuid = impl.proxiableUUID();
        if (uuid != IMPLEMENTATION_SLOT) revert WrongProxiableUUID(address(impl), uuid);

        UUPSUpgradeable(address(registry)).upgradeToAndCall(address(impl), "");
        address now_ = _implementationOf(address(registry));
        if (now_ != address(impl)) revert UpgradeDidNotTakeEffect(address(impl), now_);
        console.log("A. upgrade: implementation now", address(impl));
    }

    function _hasIdentitySupport(FuguRegistry registry) internal view returns (bool ok) {
        (ok,) = address(registry).staticcall(abi.encodeWithSignature("identityRegistry()"));
    }

    // -----------------------------------------------------------------------------
    // B. configure
    // -----------------------------------------------------------------------------

    function _configureIfNeeded(FuguRegistry registry) internal {
        _configureIfNeeded(registry, IDENTITY_REGISTRY);
    }

    /// @dev The identity registry is a parameter so the test can point it at a mock.
    function _configureIfNeeded(FuguRegistry registry, address identityRegistry_) internal {
        if (registry.identityRegistry() == identityRegistry_) {
            console.log("B. setIdentityRegistry: skipped, already", identityRegistry_);
            return;
        }
        registry.setIdentityRegistry(identityRegistry_);
        console.log("B. setIdentityRegistry:", identityRegistry_);
    }

    // -----------------------------------------------------------------------------
    // C + D. finalize each registration file, then rebind
    // -----------------------------------------------------------------------------

    /// @dev Split out of `run()` so the identical path runs against a local registry in
    ///      `test/Erc8004MigrationScripts.t.sol`. Every listing is classified before the
    ///      first write, so one bad id stops the run with nothing sent.
    function _rebindAll(
        FuguRegistry registry,
        IErc8004IdentityRegistry identity,
        address sender,
        uint256[] memory ids
    ) internal {
        Agent[N] memory agents = _agents();
        Stage[N] memory stages;
        for (uint256 i = 0; i < N; ++i) {
            (stages[i],) = _stage(registry, identity, sender, agents[i], ids);
            if (stages[i] == Stage.Missing) revert MissingAgentId(agents[i].listingId);
        }

        for (uint256 i = 0; i < N; ++i) {
            Agent memory a = agents[i];
            uint256 id = ids[i];

            string memory finalURI = _finalURI(a, id);
            if (keccak256(bytes(identity.tokenURI(id))) != keccak256(bytes(finalURI))) {
                identity.setAgentURI(id, finalURI);
                console.log("C. registration file finalized:", a.name, id);
            }

            if (stages[i] == Stage.Rebound) {
                console.log("D. rebind: skipped, already bound:", a.name, id);
                continue;
            }
            registry.rebindAgentId(a.listingId, id);
            console.log("D. rebound listing", a.listingId, "to", id);
        }
    }

    // -----------------------------------------------------------------------------
    // Verification — runs in the simulation too, so a mismatch aborts before sending
    // -----------------------------------------------------------------------------

    function _verifyAll(
        FuguRegistry registry,
        IErc8004IdentityRegistry identity,
        uint256[] memory ids,
        Listing[N] memory before
    ) internal view {
        Agent[N] memory agents = _agents();
        for (uint256 i = 0; i < N; ++i) {
            uint256 listingId = i + 1;
            Listing memory l = registry.getListing(listingId);
            if (l.erc8004AgentId != ids[i]) revert NotRebound(listingId, ids[i], l.erc8004AgentId);
            if (registry.listingByAgentId(ids[i]) != listingId) revert NotRebound(listingId, ids[i], 0);
            if (registry.listingByAgentId(FIRST_PLACEHOLDER + i) != 0) {
                revert PlaceholderNotReleased(listingId, FIRST_PLACEHOLDER + i);
            }
            if (keccak256(bytes(identity.tokenURI(ids[i]))) != keccak256(bytes(_finalURI(agents[i], ids[i])))) {
                revert UriNotFinal(listingId, ids[i]);
            }
            _requireUnmoved(listingId, before[i], l);
        }
    }

    /// @dev Everything except `erc8004AgentId` must be what it was before the run.
    function _requireUnmoved(uint256 listingId, Listing memory b, Listing memory a) internal pure {
        if (a.owner != b.owner) revert ListingFieldMoved(listingId, "owner");
        if (a.agentWallet != b.agentWallet) revert ListingFieldMoved(listingId, "agentWallet");
        if (a.category != b.category) revert ListingFieldMoved(listingId, "category");
        if (a.priceUsd8PerPeriod != b.priceUsd8PerPeriod) revert ListingFieldMoved(listingId, "priceUsd8PerPeriod");
        if (a.periodSeconds != b.periodSeconds) revert ListingFieldMoved(listingId, "periodSeconds");
        if (a.active != b.active) revert ListingFieldMoved(listingId, "active");
        if (a.curated != b.curated) revert ListingFieldMoved(listingId, "curated");
        if (keccak256(bytes(a.metadataURI)) != keccak256(bytes(b.metadataURI))) {
            revert ListingFieldMoved(listingId, "metadataURI");
        }
    }

    function _logResult(FuguRegistry registry, IErc8004IdentityRegistry identity) internal view {
        console.log("== Result (re-read from chain) ==");
        console.log("implementation         ", _implementation());
        console.log("identityRegistry       ", registry.identityRegistry());
        console.log("listingCount           ", registry.listingCount());
        Agent[N] memory agents = _agents();
        for (uint256 i = 0; i < N; ++i) {
            Listing memory l = registry.getListing(i + 1);
            console.log("--", agents[i].name);
            console.log("  listingId        ", i + 1);
            console.log("  erc8004AgentId   ", l.erc8004AgentId);
            console.log("  identity owner   ", identity.ownerOf(l.erc8004AgentId));
            console.log("  placeholder freed", FIRST_PLACEHOLDER + i);
        }
    }

    function _implementation() internal view returns (address) {
        return _implementationOf(REGISTRY);
    }

    function _implementationOf(address proxy) internal view returns (address) {
        return address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));
    }
}
