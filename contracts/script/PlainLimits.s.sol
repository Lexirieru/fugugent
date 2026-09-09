// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Listing} from "../src/types/FuguTypes.sol";

/// @title  Rewrite the `limits` sentence a buyer reads before paying
/// @notice `limits` is what the marketplace shows under "What this agent does not do yet",
///         directly above the pay button. On a phone, Fugu Guardian's ran to fifteen lines
///         and read like an internal ticket: MCP/A2A tool, updateListing, "FuguRegistry has
///         no setter for it", "would double the HEALTH_FACTOR category count", and a pointer
///         to four lettered sections of a document.
///
///         Every one of those statements is true. None of them helps the person deciding
///         whether to hand over money, and a warning nobody finishes reading is not a
///         warning. The rewrite keeps each claim and drops the vocabulary.
///
/// @dev    **Nothing is softened.** The hard sentences are the point of this field and they
///         stay: it has never sent a transaction, hiring it starts nothing, the kill switch
///         is proven only in tests, the wallet named on the listing is not the agent's.
///         What goes is the jargon carrying them.
///
///         `proof` and `verify` are untouched. They are for the reader who wants to check,
///         and that reader wants the exact contract name, the selector and the command.
///
///         Run:
///           forge script script/PlainLimits.s.sol --rpc-url $BSC_TESTNET_RPC_URL \
///             --broadcast --private-key $PRIVATE_KEY
contract PlainLimits is Script {
    address internal constant REGISTRY = 0xb2f36070E6eae3353E8e755172B477DF213ae248;
    uint256 internal constant EXPECTED_CHAIN_ID = 97;

    /// @dev One entry per listing whose summary is being rewritten. `erc8004AgentId` is the
    ///      guard: a listing id alone could silently point somewhere else after any change to
    ///      the catalogue, and rewriting the wrong listing is not reversible in a way anyone
    ///      would notice.
    struct Rewrite {
        uint256 listingId;
        uint256 erc8004AgentId;
        string name;
        string limits;
    }

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string what, address at);
    error WrongListing(uint256 listingId, uint256 expectedAgentId, uint256 actualAgentId);
    error NotListingOwner(address owner, address sender);
    error PriceMoved(uint256 listingId, uint128 before_, uint128 after_);
    error PeriodMoved(uint256 listingId, uint32 before_, uint32 after_);
    error WalletMoved(uint256 listingId, address before_, address after_);
    error MetadataUnchanged(uint256 listingId);

    function _rewrites() internal pure returns (Rewrite[4] memory r) {
        r[0] = Rewrite({
            listingId: 1,
            erc8004AgentId: 8004,
            name: "Fugu Guardian",
            limits: "It has repaid a real loan once, from a script we ran by hand. The copy of it that runs here on a schedule has never sent anything: every cycle so far has looked at the loan and decided to do nothing, which is the right answer while the loan is far from trouble. Hiring it holds your payment and starts nothing today. There is a switch that stops it, and we have only proved that switch works in tests, never against a payment it was about to make. One more thing, because you can see it on the explorer and it looks wrong: the wallet address recorded on this listing is ours, not the agent's. That field cannot be changed after a listing is created."
        });
        r[1] = Rewrite({
            listingId: 2,
            erc8004AgentId: 8005,
            name: "Fugu Rebalancer",
            limits: "It can decide, and it cannot act. The rules that pick the trade are written and tested and you can run them yourself, but this agent has never sent a transaction. Hiring it holds your payment until it is claimed and starts nothing that runs on its own."
        });
        r[2] = Rewrite({
            listingId: 3,
            erc8004AgentId: 8006,
            name: "Fugu Grid",
            limits: "It can decide, and it cannot act. The rules that place the orders are written and tested and you can run them yourself, but this agent has never sent a transaction. Hiring it holds your payment until it is claimed and starts nothing that runs on its own."
        });
        r[3] = Rewrite({
            listingId: 4,
            erc8004AgentId: 8007,
            name: "Fugu Yield",
            limits: "It can decide, and it cannot act. The rules that choose where to move the money are written and tested and you can run them yourself, but this agent has never sent a transaction. Hiring it holds your payment until it is claimed and starts nothing that runs on its own."
        });
    }

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address sender = vm.addr(pk);
        FuguRegistry registry = FuguRegistry(REGISTRY);

        vm.startBroadcast(pk);
        _rewriteAll(registry, sender);
        vm.stopBroadcast();
    }

    /// @dev Split out so the identical path runs against a local registry in
    ///      `test/PlainSummariesScript.t.sol`: no env vars, no broadcast, and no tBNB spent to
    ///      discover a swapped argument.
    function _rewriteAll(FuguRegistry registry, address sender) internal {
        Rewrite[4] memory rewrites = _rewrites();

        for (uint256 i = 0; i < rewrites.length; ++i) {
            Rewrite memory w = rewrites[i];
            Listing memory before = registry.getListing(w.listingId);

            if (before.erc8004AgentId != w.erc8004AgentId) {
                revert WrongListing(w.listingId, w.erc8004AgentId, before.erc8004AgentId);
            }
            if (before.owner != sender) revert NotListingOwner(before.owner, sender);

            string memory next = _rewriteField(before.metadataURI, w.limits);
            registry.updateListing(w.listingId, before.priceUsd8PerPeriod, before.periodSeconds, next);

            Listing memory afterL = registry.getListing(w.listingId);
            if (afterL.priceUsd8PerPeriod != before.priceUsd8PerPeriod) {
                revert PriceMoved(w.listingId, before.priceUsd8PerPeriod, afterL.priceUsd8PerPeriod);
            }
            if (afterL.periodSeconds != before.periodSeconds) {
                revert PeriodMoved(w.listingId, before.periodSeconds, afterL.periodSeconds);
            }
            // No mutation can kill this check today, and it is kept anyway. `updateListing`
            // has no path to `agentWallet`, so the failure it guards against is impossible
            // in the current contract and no test can distinguish its presence. It exists
            // for the version of `updateListing` that gains the field: that address is the
            // one thing about a listing that can never be corrected afterwards.
            if (afterL.agentWallet != before.agentWallet) {
                revert WalletMoved(w.listingId, before.agentWallet, afterL.agentWallet);
            }
            if (keccak256(bytes(afterL.metadataURI)) == keccak256(bytes(before.metadataURI))) {
                revert MetadataUnchanged(w.listingId);
            }

            console.log("rewrote limits for listing", w.listingId, w.name);
        }
    }

    /// @notice Replace the value of `"summary"` inside a `data:application/json;base64,` URI.
    /// @dev Decoding the existing metadata and swapping one field is deliberate. Rebuilding the
    ///      whole JSON here would mean keeping a second copy of `proof`, `limits` and `verify`
    ///      in this file, and two copies of an evidence string is how one of them quietly stops
    ///      matching what actually happened.
    function _rewriteField(string memory uri, string memory value) internal pure returns (string memory) {
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory raw = bytes(uri);
        require(raw.length > prefix.length, "metadata is not a data URI");

        bytes memory b64 = new bytes(raw.length - prefix.length);
        for (uint256 i = 0; i < b64.length; ++i) {
            b64[i] = raw[i + prefix.length];
        }
        string memory json = string(_decodeBase64(string(b64)));
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_replaceField(json, value))));
    }

    /// @dev Splits the JSON at `"limits":"` and at the closing quote of its value. None of the
    ///      four strings being replaced contains an escaped quote, and the new ones do not
    ///      either, so a plain scan is correct here and a JSON parser would be a lot of code to
    ///      reach the same answer.
    function _replaceField(string memory json, string memory value) internal pure returns (string memory) {
        bytes memory j = bytes(json);
        bytes memory key = bytes('"limits":"');

        uint256 start = _indexOf(j, key, 0);
        require(start != type(uint256).max, "no limits field");
        uint256 valueStart = start + key.length;
        uint256 valueEnd = _indexOf(j, bytes('"'), valueStart);
        require(valueEnd != type(uint256).max, "unterminated limits");

        bytes memory head = new bytes(valueStart);
        for (uint256 i = 0; i < valueStart; ++i) head[i] = j[i];
        bytes memory tail = new bytes(j.length - valueEnd);
        for (uint256 i = 0; i < tail.length; ++i) tail[i] = j[valueEnd + i];

        return string.concat(string(head), value, string(tail));
    }

    function _indexOf(bytes memory haystack, bytes memory needle, uint256 from) internal pure returns (uint256) {
        if (needle.length == 0 || haystack.length < needle.length) return type(uint256).max;
        for (uint256 i = from; i + needle.length <= haystack.length; ++i) {
            bool hit = true;
            for (uint256 k = 0; k < needle.length; ++k) {
                if (haystack[i + k] != needle[k]) {
                    hit = false;
                    break;
                }
            }
            if (hit) return i;
        }
        return type(uint256).max;
    }

    /// @dev OpenZeppelin ships an encoder but no decoder, and the metadata has to be read back
    ///      before one field of it can be changed.
    function _decodeBase64(string memory data) internal pure returns (bytes memory) {
        bytes memory d = bytes(data);
        if (d.length == 0) return new bytes(0);
        require(d.length % 4 == 0, "bad base64 length");

        uint256 pad = 0;
        if (d[d.length - 1] == "=") pad++;
        if (d[d.length - 2] == "=") pad++;

        bytes memory out = new bytes((d.length / 4) * 3 - pad);
        uint256 o = 0;
        for (uint256 i = 0; i < d.length; i += 4) {
            uint256 chunk = (uint256(_b64Value(d[i])) << 18) | (uint256(_b64Value(d[i + 1])) << 12)
                | (uint256(_b64Value(d[i + 2])) << 6) | uint256(_b64Value(d[i + 3]));
            if (o < out.length) out[o++] = bytes1(uint8(chunk >> 16));
            if (o < out.length) out[o++] = bytes1(uint8((chunk >> 8) & 0xFF));
            if (o < out.length) out[o++] = bytes1(uint8(chunk & 0xFF));
        }
        return out;
    }

    function _b64Value(bytes1 c) internal pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 65 && v <= 90) return v - 65; // A-Z
        if (v >= 97 && v <= 122) return v - 71; // a-z
        if (v >= 48 && v <= 57) return v + 4; // 0-9
        if (v == 43) return 62; // +
        if (v == 47) return 63; // /
        if (v == 61) return 0; // = padding
        revert("bad base64 char");
    }
}
