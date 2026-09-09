// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Listing} from "../src/types/FuguTypes.sol";

/// @title  Rewrite the four built agents' on-chain summaries in plain language
/// @notice The `summary` field is the sentence a buyer reads on the agent card, and for the
///         four agents that were listed first it was written for an engineer:
///
///           "Drift-band rebalancer: a 500 bps band plus a 50 bps cost gate on turnover. The
///            minimum economic turnover is derived from gas and budget
///            (T >= gas * 10000 / (M - r)) and returns null when the budget makes rebalancing
///            impossible, instead of quietly never trading."
///
///         Every word of that is true and almost none of it is readable by the person deciding
///         whether to pay. The five agents listed later were already written plainly; this
///         brings the first four up to the same standard.
///
/// @dev    **Only `summary` changes.** `proof`, `limits` and `verify` are evidence rather than
///         marketing, and they keep their exact wording: someone checking a claim needs the
///         transaction hash and the command, not a friendlier paraphrase. No claim is dropped,
///         softened or added. `T >= gas * 10000 / (M - r)` disappears from the card and stays in
///         `ai/fugurebalancer`, where it is the code rather than the pitch.
///
///         `updateListing` carries price and period through unchanged and cannot touch
///         `agentWallet`. Money-carrying fields are re-read afterwards and the script reverts if
///         any of them moved.
///
///         Run:
///           forge script script/PlainSummaries.s.sol --rpc-url $BSC_TESTNET_RPC_URL \
///             --broadcast --private-key $PRIVATE_KEY
contract PlainSummaries is Script {
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
        string summary;
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
            summary: "Watches a loan and pays part of it back before the loan can be closed out from under you. It reads the numbers straight from the blockchain, decides with fixed rules rather than an AI model, and signs with a key that is allowed to call exactly two functions and nothing else."
        });
        r[1] = Rewrite({
            listingId: 2,
            erc8004AgentId: 8005,
            name: "Fugu Rebalancer",
            summary: "Keeps your holdings at the mix you chose. It only trades when the drift is large enough to be worth what the trade costs, and when your budget is too small for that to ever be true it says so, instead of sitting there doing nothing without telling you."
        });
        r[2] = Rewrite({
            listingId: 3,
            erc8004AgentId: 8006,
            name: "Fugu Grid",
            summary: "Buys a step down and sells a step up, again and again, inside a price range you set. Its own backtest shows that simply holding beats it when the price keeps moving one way, and it tells you that rather than hiding it."
        });
        r[3] = Rewrite({
            listingId: 4,
            erc8004AgentId: 8007,
            name: "Fugu Yield",
            summary: "Moves your money to a better paying pool only when the extra pay clearly beats the cost of moving it. The smaller the amount, or the shorter you plan to stay, the bigger that gap has to be, so the highest advertised rate is often the wrong answer."
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

            string memory next = _rewriteSummary(before.metadataURI, w.summary);
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

            console.log("rewrote summary for listing", w.listingId, w.name);
        }
    }

    /// @notice Replace the value of `"summary"` inside a `data:application/json;base64,` URI.
    /// @dev Decoding the existing metadata and swapping one field is deliberate. Rebuilding the
    ///      whole JSON here would mean keeping a second copy of `proof`, `limits` and `verify`
    ///      in this file, and two copies of an evidence string is how one of them quietly stops
    ///      matching what actually happened.
    function _rewriteSummary(string memory uri, string memory summary) internal pure returns (string memory) {
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory raw = bytes(uri);
        require(raw.length > prefix.length, "metadata is not a data URI");

        bytes memory b64 = new bytes(raw.length - prefix.length);
        for (uint256 i = 0; i < b64.length; ++i) {
            b64[i] = raw[i + prefix.length];
        }
        string memory json = string(_decodeBase64(string(b64)));
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_replaceSummary(json, summary))));
    }

    /// @dev Splits the JSON at `"summary":"` and at the closing quote of its value. None of the
    ///      four summaries being replaced contains an escaped quote, and the new ones do not
    ///      either, so a plain scan is correct here and a JSON parser would be a lot of code to
    ///      reach the same answer.
    function _replaceSummary(string memory json, string memory summary) internal pure returns (string memory) {
        bytes memory j = bytes(json);
        bytes memory key = bytes('"summary":"');

        uint256 start = _indexOf(j, key, 0);
        require(start != type(uint256).max, "no summary field");
        uint256 valueStart = start + key.length;
        uint256 valueEnd = _indexOf(j, bytes('"'), valueStart);
        require(valueEnd != type(uint256).max, "unterminated summary");

        bytes memory head = new bytes(valueStart);
        for (uint256 i = 0; i < valueStart; ++i) head[i] = j[i];
        bytes memory tail = new bytes(j.length - valueEnd);
        for (uint256 i = 0; i < tail.length; ++i) tail[i] = j[valueEnd + i];

        return string.concat(string(head), summary, string(tail));
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
