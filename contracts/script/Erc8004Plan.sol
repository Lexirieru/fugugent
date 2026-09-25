// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Listing} from "../src/types/FuguTypes.sol";

/// @notice The slice of the ERC-8004 IdentityRegistry the migration scripts call.
/// @dev Declared here rather than imported: the live contract ("AgentIdentity" 2.0.0) is
///      not in this repository, and these five signatures were read from its ABI.
interface IErc8004IdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
    function ownerOf(uint256 agentId) external view returns (address);
    function balanceOf(address owner) external view returns (uint256);
    function tokenURI(uint256 agentId) external view returns (string memory);
}

/// @title Erc8004Plan
/// @notice What the nine HelloFugu agents say about themselves in the ERC-8004
///         IdentityRegistry, and the bookkeeping both migration phases share:
///         `RegisterErc8004Identities.s.sol` (mint) and `RebindAgentIds.s.sol` (upgrade,
///         configure, rebind).
///
/// @dev ## Two registration files per agent, on purpose
///
///      An ERC-8004 registration file names its own id in `registrations[].agentId`, and
///      that id does not exist until `register()` returns. So phase 1 mints with a DRAFT
///      whose `registrations` is `[]`, and phase 2 replaces it with the FINAL file via
///      `setAgentURI` once the id is known. Both are pure functions of the plan entry
///      (and, for the final one, the id), which is what lets phase 2 recognise its own
///      tokens: an id whose `tokenURI` is neither this listing's draft nor its final file
///      is refused, so a shuffled or mistyped `AGENT_IDS` can never bind Grid's listing to
///      Yield's identity.
///
///      ## The text comes from the listings, not from here
///
///      `name` and the first part of `description` are the `name` and `summary` fields of
///      each listing's on-chain metadata as read on 2026-09-25 — the four rewritten by
///      `PlainSummaries.s.sol`, the five written by `ListAgents.s.sol`. They are copied,
///      not paraphrased, so the marketplace card and the identity say the same sentence.
///      The limits are NOT copied: they are long, they change, and the listing is where
///      they live. The description names the listing instead, so a reader of the identity
///      is one lookup away from them.
///
///      `image` is set only for the four agents that have their own art on the landing
///      page; the five newer ones have none yet and get no image rather than a borrowed
///      one. Only Guardian gets an `A2A` service: it is the only agent whose card
///      answers at `agents.hellofugu.xyz` (checked 2026-09-25: guardian 200, rebalancer,
///      grid and yield 502, the other five 404).
abstract contract Erc8004Plan is Script {
    /// @dev BSC testnet. Change to 56 for mainnet.
    uint256 internal constant EXPECTED_CHAIN_ID = 97;

    /// @dev The FuguRegistry proxy — see `deployments/bsc-testnet.json`.
    address internal constant REGISTRY = 0xb2f36070E6eae3353E8e755172B477DF213ae248;

    /// @dev The canonical ERC-8004 IdentityRegistry on BSC testnet ("AgentIdentity" 2.0.0).
    address internal constant IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    /// @dev Owner of the FuguRegistry proxy and of all nine listings. The only address
    ///      these scripts will act as: a run from any other sender stops before sending.
    address internal constant DEPLOYER = 0x56A2950ddE6B1040d1DCC4b4C4Fc314Bd56eFB0E;

    uint256 internal constant N = 9;

    /// @dev Listing `i + 1` was created with placeholder id `FIRST_PLACEHOLDER + i`.
    uint256 internal constant FIRST_PLACEHOLDER = 8004;

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string label, address addr);
    error WrongSender(address expected, address actual);
    error NotListingOwner(uint256 listingId, address owner, address sender);
    error ListingOnUnexpectedId(uint256 listingId, uint256 erc8004AgentId);
    error AgentIdsMismatch(uint256 listingId, uint256 given, uint256 onChain);
    error IdentityNotOwned(uint256 listingId, uint256 agentId, address owner);
    error IdentityUriMismatch(uint256 listingId, uint256 agentId);

    struct Agent {
        uint256 listingId;
        string name;
        /// @dev The `summary` from the listing's on-chain metadata, verbatim.
        string summary;
        /// @dev Empty when the agent has no art of its own.
        string image;
        /// @dev The wallet the agent signs from, as its listing metadata declares it.
        ///      For Guardian that is the Altana wallet, not the deployer EOA stuck in the
        ///      listing's `agentWallet` field.
        address wallet;
        /// @dev Empty when the agent has no live A2A card.
        string a2a;
    }

    /// @dev Where a listing stands in the migration.
    enum Stage {
        /// No identity minted for it that this run knows about.
        Missing,
        /// An identity is minted (named in `AGENT_IDS`) but the listing still holds its
        /// placeholder.
        Minted,
        /// The listing already holds an identity the sender owns.
        Rebound
    }

    function _agents() internal pure returns (Agent[N] memory a) {
        a[0] = Agent({
            listingId: 1,
            name: "Fugu Guardian",
            summary: "Watches a loan and pays part of it back before the loan can be closed out from under you. It reads the numbers straight from the blockchain, decides with fixed rules rather than an AI model, and signs with a key that is allowed to call exactly two functions and nothing else.",
            image: "https://hellofugu.xyz/brand/guardian.svg",
            wallet: 0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0,
            a2a: "https://agents.hellofugu.xyz/guardian/.well-known/agent-card.json"
        });
        a[1] = Agent({
            listingId: 2,
            name: "Fugu Rebalancer",
            summary: "Keeps your holdings at the mix you chose. It only trades when the drift is large enough to be worth what the trade costs, and when your budget is too small for that to ever be true it says so, instead of sitting there doing nothing without telling you.",
            image: "https://hellofugu.xyz/brand/rebalancer.svg",
            wallet: 0xb8f155D1278f0437b9De7c63911f2C0EDa485941,
            a2a: ""
        });
        a[2] = Agent({
            listingId: 3,
            name: "Fugu Grid",
            summary: "Buys a step down and sells a step up, again and again, inside a price range you set. Its own backtest shows that simply holding beats it when the price keeps moving one way, and it tells you that rather than hiding it.",
            image: "https://hellofugu.xyz/brand/grid.svg",
            wallet: 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9,
            a2a: ""
        });
        a[3] = Agent({
            listingId: 4,
            name: "Fugu Yield",
            summary: "Moves your money to a better paying pool only when the extra pay clearly beats the cost of moving it. The smaller the amount, or the shorter you plan to stay, the bigger that gap has to be, so the highest advertised rate is often the wrong answer.",
            image: "https://hellofugu.xyz/brand/yield.svg",
            wallet: 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866,
            a2a: ""
        });
        a[4] = Agent({
            listingId: 5,
            name: "Fugu Broker",
            summary: "Hires and pays other agents on your behalf. The money is held until the work is done, so nobody is paid in advance and nobody works for free.",
            image: "",
            wallet: 0x1E77279cf18Da89EEF1477F010D2e6B1E2A1E2c3,
            a2a: ""
        });
        a[5] = Agent({
            listingId: 6,
            name: "Fugu Trader",
            summary: "Buys one call at a time, paying per request for data or for a model answer. Neither side ever holds the other side's keys.",
            image: "",
            wallet: 0x1B82F72346a8553a968fafD6AC07A21d4A88589f,
            a2a: ""
        });
        a[6] = Agent({
            listingId: 7,
            name: "Fugu Pilot",
            summary: "Moves money between lending and trading venues inside limits that it cannot exceed. The limits are set once, in advance, and the agent is refused when it tries to go past them.",
            image: "",
            wallet: 0x79AFD7B81a1D7CA57270d53Cf9FC315Cd5698c8D,
            a2a: ""
        });
        a[7] = Agent({
            listingId: 8,
            name: "Fugu Meter",
            summary: "Pays by the call, by the second, or by the unit, without a person approving each one. The permission it uses expires on its own.",
            image: "",
            wallet: 0x95c3c77e3B7d3873BcF6b9F4b12f47775e7312c8,
            a2a: ""
        });
        a[8] = Agent({
            listingId: 9,
            name: "Fugu Steward",
            summary: "Runs payments that repeat on a schedule, and keeps a record of what it already paid so a restart does not pay twice.",
            image: "",
            wallet: 0xB92Dd50E84560E719627AcE28b32060dbF0E7083,
            a2a: ""
        });
    }

    // -----------------------------------------------------------------------------
    // Registration files
    // -----------------------------------------------------------------------------

    /// @notice The file phase 1 mints with: `registrations` is empty because the id
    ///         does not exist yet.
    function _draftURI(Agent memory a) internal pure returns (string memory) {
        return _dataURI(_registrationJson(a, "[]"));
    }

    /// @notice The file phase 2 writes once the id is known.
    function _finalURI(Agent memory a, uint256 agentId) internal pure returns (string memory) {
        return _dataURI(
            _registrationJson(
                a,
                string.concat(
                    '[{"agentId":',
                    vm.toString(agentId),
                    ',"agentRegistry":"eip155:97:',
                    vm.toString(IDENTITY_REGISTRY),
                    '"}]'
                )
            )
        );
    }

    function _dataURI(string memory json) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @notice An ERC-8004 registration file (`#registration-v1`).
    /// @dev Assembled in steps: with `via_ir = false`, one `string.concat` of this many
    ///      arguments runs the legacy code generator out of stack. Field order follows the
    ///      EIP's example. `fuguListing` is ours — the EIP allows extra fields — and is
    ///      the pointer from the identity back to the listing that carries price, limits
    ///      and payouts.
    function _registrationJson(Agent memory a, string memory registrations)
        internal
        pure
        returns (string memory json)
    {
        json = string.concat('{"type":"https://eips.ethereum.org/EIPS/eip-8004#registration-v1","name":"', a.name, '"');
        json = string.concat(json, ',"description":"', _description(a), '"');
        if (bytes(a.image).length != 0) json = string.concat(json, ',"image":"', a.image, '"');
        json = string.concat(json, ',"services":', _services(a));
        json = string.concat(json, ',"registrations":', registrations);
        json = string.concat(json, ',"active":true,"x402Support":false');
        json = string.concat(
            json,
            ',"fuguListing":{"registry":"eip155:97:',
            vm.toString(REGISTRY),
            '","listingId":',
            vm.toString(a.listingId),
            "}}"
        );
    }

    /// @dev The listing summary, then one sentence that points at the limits instead of
    ///      restating them.
    function _description(Agent memory a) internal pure returns (string memory) {
        return string.concat(
            a.summary,
            " Runs on BSC testnet (chain 97) only. What it cannot do yet is written into its HelloFugu listing: FuguRegistry ",
            vm.toString(REGISTRY),
            ", listing ",
            vm.toString(a.listingId),
            "."
        );
    }

    function _services(Agent memory a) internal pure returns (string memory s) {
        s = '[{"name":"web","endpoint":"https://app.hellofugu.xyz"}';
        if (bytes(a.a2a).length != 0) {
            s = string.concat(s, ',{"name":"A2A","endpoint":"', a.a2a, '","version":"0.3.0"}');
        }
        s = string.concat(s, ',{"name":"agentWallet","endpoint":"eip155:97:', vm.toString(a.wallet), '"}]');
    }

    // -----------------------------------------------------------------------------
    // Where each listing stands
    // -----------------------------------------------------------------------------

    /// @notice Classify listing `a.listingId` without changing anything.
    /// @param agentIds The ids from `AGENT_IDS`, in listing order; may be shorter than 9,
    ///        or empty, when only some have been minted.
    /// @dev Reverts on anything that does not fit the plan: a listing the sender does not
    ///      own, a listing on an id that is neither its placeholder nor an identity the
    ///      sender holds, an `AGENT_IDS` entry the sender does not own, or one whose
    ///      `tokenURI` is not this listing's draft or final file.
    function _stage(
        FuguRegistry registry,
        IErc8004IdentityRegistry identity,
        address sender,
        Agent memory a,
        uint256[] memory agentIds
    ) internal view returns (Stage stage, uint256 agentId) {
        Listing memory l = registry.getListing(a.listingId);
        if (l.owner != sender) revert NotListingOwner(a.listingId, l.owner, sender);

        uint256 i = a.listingId - 1;
        uint256 placeholder = FIRST_PLACEHOLDER + i;
        bool given = agentIds.length > i;

        if (l.erc8004AgentId != placeholder) {
            // Already moved. It must have moved onto one of ours.
            if (_ownerOf(identity, l.erc8004AgentId) != sender) {
                revert ListingOnUnexpectedId(a.listingId, l.erc8004AgentId);
            }
            if (given && agentIds[i] != l.erc8004AgentId) {
                revert AgentIdsMismatch(a.listingId, agentIds[i], l.erc8004AgentId);
            }
            return (Stage.Rebound, l.erc8004AgentId);
        }

        if (!given) return (Stage.Missing, 0);

        agentId = agentIds[i];
        _requireOurs(identity, sender, a, agentId);
        return (Stage.Minted, agentId);
    }

    /// @dev The guard that ties an id to a listing: owned by the sender, and carrying
    ///      this agent's own registration file (draft or final).
    function _requireOurs(IErc8004IdentityRegistry identity, address sender, Agent memory a, uint256 agentId)
        internal
        view
    {
        address o = _ownerOf(identity, agentId);
        if (o != sender) revert IdentityNotOwned(a.listingId, agentId, o);
        bytes32 uri = keccak256(bytes(identity.tokenURI(agentId)));
        if (uri != keccak256(bytes(_draftURI(a))) && uri != keccak256(bytes(_finalURI(a, agentId)))) {
            revert IdentityUriMismatch(a.listingId, agentId);
        }
    }

    /// @dev `ownerOf` reverts for an id that was never minted; report that as `address(0)`.
    function _ownerOf(IErc8004IdentityRegistry identity, uint256 agentId) internal view returns (address) {
        try identity.ownerOf(agentId) returns (address o) {
            return o;
        } catch {
            return address(0);
        }
    }

    /// @dev `AGENT_IDS=2476,2477,...` in listing order; empty when unset.
    function _agentIdsFromEnv() internal view returns (uint256[] memory) {
        return vm.envOr("AGENT_IDS", ",", new uint256[](0));
    }

    function _joinIds(uint256[N] memory ids) internal pure returns (string memory s) {
        for (uint256 i = 0; i < N; ++i) {
            s = string.concat(s, i == 0 ? "" : ",", vm.toString(ids[i]));
        }
    }
}
