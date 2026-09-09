// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @title UpdateGuardianMetadata
/// @notice Keep listing 1 (Fugu Guardian) carrying a readable `metadataURI` that is
///         still true.
///
/// @dev Listing 1 was created during the earliest E2E run, before the
///      `data:application/json;base64,…` convention existed, so its
///      `metadataURI` was the placeholder `ipfs://fugu-guardian-v1`. The backend
///      metadata reader declines non-`data:` URIs on purpose (it never fetches
///      the network), so the one agent that has actually executed on-chain showed
///      up as `Agent #8004` next to three agents that cannot execute anything
///      yet but carry proper names. The first run of this script fixed that.
///
///      **This script is re-run whenever the repo overtakes the chain.** On-chain
///      metadata is the one claim about this agent that cannot be corrected
///      quietly, so it must not be left saying things that stopped being true.
///      Run 2 (2026-09-09) replaced three stale claims: the strategy is now wired
///      into the served runtime (`guardianRuntime.ts` / `guardianTools.ts` reach
///      `createGuardian()` from `dualMain.ts` and `mcpMain.ts`), a kill switch
///      exists and answers an MCP client in a separate process, and the Guardian
///      test count moved 249 → 285. Every limit that survived those changes is
///      still written into `limits` — no repay has ever left through the runtime,
///      the kill switch is only proven to stop a *send* in unit tests, and there
///      is no lever in the UI.
///
///      Usage — ALWAYS simulate first, without `--broadcast`, and read the output:
///
///      ```
///      cd contracts
///      forge script script/UpdateGuardianMetadata.s.sol:UpdateGuardianMetadata --rpc-url "$BSC_TESTNET_RPC_URL"
///      forge script script/UpdateGuardianMetadata.s.sol:UpdateGuardianMetadata --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast
///      ```
///
///      ## Why the price is read from the chain instead of typed here
///
///      `updateListing(listingId, priceUsd8PerPeriod, periodSeconds, metadataURI)`
///      overwrites all three fields at once, so a single wrong digit silently
///      reprices a live subscription listing. The price and period are therefore
///      READ from the listing and passed straight back, and they are also checked
///      against the values recorded in `deployments/bsc-testnet.json`
///      (`EXPECTED_PRICE_USD8` / `EXPECTED_PERIOD_SECONDS`): if the chain ever
///      disagrees with the record, the script aborts instead of writing a number
///      nobody reviewed. After the call, both fields are re-read and required to
///      be unchanged.
///
///      ## What this script deliberately cannot fix
///
///      `updateListing` does not touch `agentWallet`, and `FuguRegistry` has no
///      setter for it. Listing 1's `agentWallet` is still the deployer EOA rather
///      than the Guardian Altana wallet; only a brand-new listing could change
///      that, which would push `countByCategory(HEALTH_FACTOR)` to 2. So the
///      metadata declares the Altana wallet that actually signs — the backend
///      reports the disagreement with the on-chain field rather than presenting
///      either value as proof — and the limitation is written into `limits`.
///
///      `chainId` is hardcoded to 97 (BSC testnet). **Change it for mainnet.**
contract UpdateGuardianMetadata is Script {
    /// @dev BSC testnet. Change to 56 for mainnet.
    uint256 constant EXPECTED_CHAIN_ID = 97;

    /// @dev FuguRegistry proxy — see `deployments/bsc-testnet.json`.
    address constant REGISTRY = 0xb2f36070E6eae3353E8e755172B477DF213ae248;

    uint256 constant GUARDIAN_LISTING_ID = 1;
    uint256 constant GUARDIAN_AGENT_ID = 8004;

    /// @dev The values listing 1 must already hold, and must still hold afterwards.
    ///      $0.10 per 120 s, base 8 decimals. Tripwire, not an input: the values
    ///      actually written are the ones read from the chain.
    uint128 constant EXPECTED_PRICE_USD8 = 10_000_000;
    uint32 constant EXPECTED_PERIOD_SECONDS = 120;

    /// @dev The Altana wallet that signed the repay, and the Keystore that holds its
    ///      bounded session key. Both are quoted in the metadata so a reader can check
    ///      them with one `eth_call`, without an API key.
    address constant GUARDIAN_ALTANA_WALLET = 0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0;
    address constant ALTANA_KEYSTORE = 0x6b8361C29d05D498b1a12B54A37310f94171E94A;

    /// @dev The listing owner and payout address. Quoted in the metadata because it is
    ///      also the value stuck in the listing's `agentWallet` field.
    address constant DEPLOYER_EOA = 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E;

    /// @dev Canonical ERC-8004 IdentityRegistry on BSC testnet. Quoted so a reader can
    ///      confirm for themselves that no identity token has been minted for us yet.
    address constant ERC8004_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string label, address addr);
    error WrongListing(uint256 listingId, uint256 expectedAgentId, uint256 actualAgentId);
    error NotListingOwner(address expected, address actual);
    error PriceChanged(uint128 before_, uint128 after_);
    error PeriodChanged(uint32 before_, uint32 after_);
    error UnexpectedPrice(uint128 expected, uint128 actual);
    error UnexpectedPeriod(uint32 expected, uint32 actual);
    error MetadataNotWritten(uint256 listingId);

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(pk);
        FuguRegistry registry = FuguRegistry(REGISTRY);

        Listing memory before = registry.getListing(GUARDIAN_LISTING_ID);

        // Guard against updating the wrong listing id: it must be the Guardian entry,
        // and the broadcasting key must be its owner (`updateListing` is owner-only).
        if (before.erc8004AgentId != GUARDIAN_AGENT_ID) {
            revert WrongListing(GUARDIAN_LISTING_ID, GUARDIAN_AGENT_ID, before.erc8004AgentId);
        }
        if (before.owner != sender) revert NotListingOwner(before.owner, sender);

        console.log("== Context (verify before broadcasting) ==");
        console.log("chainId                ", block.chainid);
        console.log("FuguRegistry           ", REGISTRY);
        console.log("listingId              ", GUARDIAN_LISTING_ID);
        console.log("sender (listing owner) ", sender);
        console.log("sender balance (wei)   ", sender.balance);
        console.log("price now (USD 8dp)    ", uint256(before.priceUsd8PerPeriod));
        console.log("period now (seconds)   ", uint256(before.periodSeconds));
        console.log("metadataURI now        ", before.metadataURI);

        vm.startBroadcast(pk);
        _updateMetadata(registry);
        vm.stopBroadcast();

        _verify(registry, before);
        _logResult(registry);
    }

    /// @notice Rewrite only `metadataURI`, carrying price and period through unchanged.
    /// @dev Split out so the identical path runs against a local registry in
    ///      `test/UpdateGuardianMetadataScript.t.sol` — no env vars, no broadcast,
    ///      and no tBNB spent to discover a swapped argument.
    function _updateMetadata(FuguRegistry registry) internal {
        Listing memory l = registry.getListing(GUARDIAN_LISTING_ID);

        // The values written are the ones the chain already holds; the constants only
        // decide whether we are allowed to proceed at all.
        if (l.priceUsd8PerPeriod != EXPECTED_PRICE_USD8) {
            revert UnexpectedPrice(EXPECTED_PRICE_USD8, l.priceUsd8PerPeriod);
        }
        if (l.periodSeconds != EXPECTED_PERIOD_SECONDS) {
            revert UnexpectedPeriod(EXPECTED_PERIOD_SECONDS, l.periodSeconds);
        }

        registry.updateListing(GUARDIAN_LISTING_ID, l.priceUsd8PerPeriod, l.periodSeconds, _metadata());
        console.log("metadataURI rewritten for listing", GUARDIAN_LISTING_ID);
    }

    /// @notice Fail loudly unless money-carrying fields are byte-identical afterwards.
    function _verify(FuguRegistry registry, Listing memory before) internal view {
        Listing memory now_ = registry.getListing(GUARDIAN_LISTING_ID);
        if (now_.priceUsd8PerPeriod != before.priceUsd8PerPeriod) {
            revert PriceChanged(before.priceUsd8PerPeriod, now_.priceUsd8PerPeriod);
        }
        if (now_.periodSeconds != before.periodSeconds) {
            revert PeriodChanged(before.periodSeconds, now_.periodSeconds);
        }
        if (bytes(now_.metadataURI).length == 0) revert MetadataNotWritten(GUARDIAN_LISTING_ID);
        if (keccak256(bytes(now_.metadataURI)) != keccak256(bytes(_metadata()))) {
            revert MetadataNotWritten(GUARDIAN_LISTING_ID);
        }
    }

    /// @notice Guardian's metadata as a self-contained `data:` URI.
    function _metadata() internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_metadataJson())));
    }

    /// @notice The raw JSON, before base64 wrapping.
    /// @dev Same field shape the other three listings use, so the backend reads it
    ///      through the already-tested path (`name`, `summary`, `onchainExecution`,
    ///      `limits`, `verify`, `agentWallet`).
    ///
    ///      `onchainExecution` is **true** here, and that is the one field that
    ///      separates Guardian from the other three: it has actually moved a position
    ///      on BSC testnet through a bounded Altana session key. `limits` still says
    ///      what is missing, so the difference is a claim about evidence, not marketing.
    ///      Assembled in steps rather than one big `string.concat`: with `via_ir = false`
    ///      in `foundry.toml`, a single concat of this many arguments makes the legacy
    ///      code generator run out of stack ("Stack too deep"). The compiler settings
    ///      stay untouched — the deployed implementations were verified on BscScan with
    ///      exactly those settings.
    function _metadataJson() internal pure returns (string memory json) {
        json = '{"name":"Fugu Guardian","agent":"fuguguardian","category":"HEALTH_FACTOR"';
        json = string.concat(json, ',"agentWallet":"', vm.toString(GUARDIAN_ALTANA_WALLET), '"');
        json = string.concat(
            json,
            ',"summary":"Watches a lending position and repays debt before it can be liquidated. It reads the health factor from chain, decides with deterministic code that never calls an LLM, and signs the repay with an Altana session key allowed to call exactly two functions."'
        );
        json = string.concat(json, ',"onchainExecution":true');
        json = string.concat(
            json,
            ',"proof":"Raised a position from health factor 1.14 to 1.50 on BSC testnet by repaying $4.03 in one atomic userOp (approve + repay), tx 0x619cfbe351703913ebafd0e76db86af0f90953bbff33335d78d8dbf1e41e08cc at block 129852222. Repay.user on the receipt is the Altana wallet, not the deployer EOA, and the on-chain debt fell by exactly the amount claimed. The same key was refused when it tried an off-allowlist transfer. '
        );
        json = string.concat(
            json,
            'The strategy also runs inside the agent that is served: guardianRuntime.ts and guardianTools.ts call createGuardian() from dualMain.ts and mcpMain.ts, and five monitoring cycles 15 seconds apart were watched against this BSC testnet position under bag dev (each action NONE, health factor 8.49). A kill switch exists and was pulled from a separate process: an MCP client called guardian_kill_switch over http, the next cycle refused with Kill switch engaged: execution is stopped entirely, killed:true was persisted, and monitoring carried on reading the position."'
        );
        json = string.concat(
            json,
            ',"limits":"No repay has ever been sent through the runtime. The only on-chain repay Guardian has made is the script transaction quoted above; every live loop cycle so far decided NONE. That the kill switch stops an actual send is proven in unit tests only, not on chain: the live position sits at health factor 8.49, so the cycle after the kill would have answered NONE regardless, and the testnet price was deliberately not manipulated to manufacture an emergency. There is no kill switch lever in the UI either - what exists is an MCP/A2A tool, a lever for a client rather than for a person in a browser. Hiring records payment in escrow and does not start an autonomous loop today. '
        );
        json = string.concat(
            json,
            'The on-chain agentWallet field of this listing still holds the deployer EOA ',
            vm.toString(DEPLOYER_EOA),
            ' because updateListing cannot change that field and FuguRegistry has no setter for it: only a new listing could, which would double the HEALTH_FACTOR category count. See docs/STATUS.md sections A4, A9, B1 and B2."'
        );
        json = string.concat(
            json,
            ',"verify":"cast call --rpc-url $BSC_TESTNET_RPC_URL ',
            vm.toString(ALTANA_KEYSTORE),
            " 'isValidKey(address,bytes32)(bool)' ",
            vm.toString(GUARDIAN_ALTANA_WALLET),
            ' 0x7a467115cdf6d03f85f0f059733843b43cbe291d9f4489e3bf27d45e5148b377  # true, no API key needed. Strategy and runtime tests: cd ai/fuguguardian/app/agent && corepack pnpm test  # 285 tests, 36 of them the runtime tests. The runtime wiring itself: grep -rn strategy ai/fuguguardian/app/agent/src/*.ts"'
        );
        json = string.concat(
            json,
            ',"erc8004Identity":"placeholder id, locally unique in FuguRegistry only: no ERC-8004 IdentityRegistry token has been minted for this wallet at ',
            vm.toString(ERC8004_IDENTITY_REGISTRY),
            '","chainId":97}'
        );
    }

    function _logResult(FuguRegistry registry) internal view {
        Listing memory l = registry.getListing(GUARDIAN_LISTING_ID);
        console.log("== Result (re-read from chain) ==");
        console.log("erc8004AgentId         ", l.erc8004AgentId);
        console.log("category (enum)        ", uint256(uint8(l.category)));
        console.log("priceUsd8PerPeriod     ", uint256(l.priceUsd8PerPeriod));
        console.log("periodSeconds          ", uint256(l.periodSeconds));
        console.log("owner                  ", l.owner);
        console.log("agentWallet (unchanged)", l.agentWallet);
        console.log("active                 ", l.active);
        console.log("metadataURI length     ", bytes(l.metadataURI).length);
        console.log("listingCount           ", registry.listingCount());
        console.log("countByCategory(3)     ", registry.countByCategory(Category.HEALTH_FACTOR));
    }
}
