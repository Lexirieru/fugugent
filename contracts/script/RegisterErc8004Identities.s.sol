// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Script.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Erc8004Plan, IErc8004IdentityRegistry} from "./Erc8004Plan.sol";

/// @title RegisterErc8004Identities
/// @notice Phase 1 of 2: mint one real ERC-8004 identity per HelloFugu listing, from the
///         deployer, in the canonical IdentityRegistry on BSC testnet.
///
///         Listings 1..9 of `FuguRegistry` hold `erc8004AgentId` 8004..8012. Those were
///         placeholders from the start (see `ListAgents.s.sol`): `ownerOf(8004)` reverts
///         on the IdentityRegistry, whose highest id on 2026-09-25 is 2475. Left alone they
///         would collide with real third-party agents once the registry grows past 8004,
///         and the BNB Chain Phase 2 requirement is that agents are read from that
///         registry. This script mints the identities; `RebindAgentIds.s.sol` (phase 2)
///         moves the listings onto them.
///
/// @dev Usage — ALWAYS simulate first, without `--broadcast`, and read the output:
///
///      ```
///      cd contracts
///      forge script script/RegisterErc8004Identities.s.sol:RegisterErc8004Identities \
///        --rpc-url "$BSC_TESTNET_RPC_URL" --sender 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E
///      forge script script/RegisterErc8004Identities.s.sol:RegisterErc8004Identities \
///        --rpc-url "$BSC_TESTNET_RPC_URL" --private-key "$PRIVATE_KEY" --broadcast
///      ```
///
///      The last lines it prints are `AGENT_IDS=...`: phase 2 needs exactly that line.
///
///      ## The ids in a simulation are a forecast, not a fact
///
///      `register()` returns the next id, and anyone on testnet can take the next id
///      between the simulation and the broadcast. The ids that count are the ones in the
///      broadcast receipts (`broadcast/RegisterErc8004Identities.s.sol/97/run-latest.json`,
///      the `Registered` event of each tx). If they differ from what the simulation
///      printed, use the receipts. Phase 2 checks every id's owner and `tokenURI` before
///      binding it, so a wrong id makes it stop, not bind the wrong agent.
///
///      ## Idempotent
///
///      A listing is skipped when it already holds an identity the deployer owns (phase 2
///      has run for it), or when `AGENT_IDS` names an identity minted for it by an
///      earlier run (checked by owner and by its exact registration file). Before minting
///      anything, the deployer's identity balance must equal the number of identities
///      accounted for that way: a balance that is higher means an earlier run minted
///      tokens this run does not know about, and minting again would leave orphans. Pass
///      the earlier ids in `AGENT_IDS` (in listing order; a partial list is fine) and
///      re-run.
///
///      The registry mints with `_mint`, not `_safeMint` (its bytecode has no
///      `onERC721Received` selector), so the sender needs no ERC-721 receiver; it is an
///      EOA anyway.
contract RegisterErc8004Identities is Erc8004Plan {
    error UnaccountedIdentities(uint256 balance, uint256 accountedFor);

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);
        if (IDENTITY_REGISTRY.code.length == 0) revert NoCode("IDENTITY_REGISTRY", IDENTITY_REGISTRY);
        // `msg.sender` here is `--sender`, or the address of `--private-key`. Refusing any
        // other address is what stops the default Foundry sender from "succeeding" a
        // simulation whose every tx would revert.
        if (msg.sender != DEPLOYER) revert WrongSender(DEPLOYER, msg.sender);

        FuguRegistry registry = FuguRegistry(REGISTRY);
        IErc8004IdentityRegistry identity = IErc8004IdentityRegistry(IDENTITY_REGISTRY);
        uint256[] memory given = _agentIdsFromEnv();

        console.log("== Context (verify before broadcasting) ==");
        console.log("chainId                ", block.chainid);
        console.log("FuguRegistry           ", REGISTRY);
        console.log("IdentityRegistry       ", IDENTITY_REGISTRY);
        console.log("sender                 ", msg.sender);
        console.log("sender balance (wei)   ", msg.sender.balance);
        console.log("identity balance before", identity.balanceOf(msg.sender));
        console.log("AGENT_IDS given        ", given.length);

        vm.startBroadcast(msg.sender);
        uint256[N] memory ids = _registerAll(registry, identity, msg.sender, given);
        vm.stopBroadcast();

        console.log("== Result ==");
        console.log("identity balance after ", identity.balanceOf(msg.sender));
        console.log("Next: RebindAgentIds.s.sol with");
        console.log(string.concat("AGENT_IDS=", _joinIds(ids)));
    }

    /// @notice Mint the identities that are missing; return all nine ids in listing order.
    /// @dev Split out of `run()` so the identical path runs against a local registry in
    ///      `test/Erc8004MigrationScripts.t.sol`: no env vars, no broadcast, no tBNB.
    ///      Every listing is classified BEFORE anything is minted, so a listing that does
    ///      not fit the plan stops the run with nothing sent.
    function _registerAll(
        FuguRegistry registry,
        IErc8004IdentityRegistry identity,
        address sender,
        uint256[] memory given
    ) internal returns (uint256[N] memory ids) {
        Agent[N] memory agents = _agents();
        Stage[N] memory stages;
        uint256 accounted;
        for (uint256 i = 0; i < N; ++i) {
            (stages[i], ids[i]) = _stage(registry, identity, sender, agents[i], given);
            if (stages[i] != Stage.Missing) ++accounted;
        }

        uint256 balance = identity.balanceOf(sender);
        if (balance != accounted) revert UnaccountedIdentities(balance, accounted);

        for (uint256 i = 0; i < N; ++i) {
            Agent memory a = agents[i];
            if (stages[i] == Stage.Rebound) {
                console.log("skipped (listing already rebound):", a.name, ids[i]);
                continue;
            }
            if (stages[i] == Stage.Minted) {
                console.log("skipped (minted earlier, AGENT_IDS):", a.name, ids[i]);
                continue;
            }
            ids[i] = identity.register(_draftURI(a));
            console.log("minted:", a.name, ids[i]);
        }
    }
}
