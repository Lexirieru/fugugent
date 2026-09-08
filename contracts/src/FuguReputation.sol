// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";

/// @title FuguReputation
/// @notice Reviews that only a wallet which has paid an agent a meaningful amount can
///         write.
/// @dev **What this gate really guarantees — and what it does not.**
///      The right to review opens once the agent has actually RECEIVED at least some
///      percentage of the price of one full period (50% by default, see
///      `FuguSubscription.minPaidBpsOfPeriod`). This is an economic threshold, not proof
///      of identity: sybils remain possible for anyone willing to pay half a period per
///      wallet, and that money goes to the very agent being reviewed.
///      **The important limit anyone reading a rating must know:** the denominator of the
///      threshold is the listing's own one-period price, set by the listing owner before
///      it locks on each wallet's first subscription. A listing owner who wants to inflate
///      the rating of THEIR OWN listing can drop the price to a dust value, let their own
///      wallets subscribe, then raise the price again — the net cost is only the protocol
///      fee and gas. This gate is therefore expensive for an outsider attacking SOMEONE
///      ELSE'S agent rating, but it does not stop an owner from polishing their own.
///      Curation and ERC-8004 ownership verification are the layers that close that gap,
///      and neither is complete yet.
/// @dev Trust boundary: The anti-sybil gate applies to end users. The contract owner
///      is a trusted entity who can bypass the gate by calling setSubscriptions() to
///      point to a malicious subscription contract, or by upgrading the contract logic
///      via UUPS. Ownership will be transferred to a multisig after hackathon period.
contract FuguReputation is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    struct Agg {
        uint128 sum;
        uint128 count;
    }

    IFuguSubscription public subscriptions;
    mapping(uint256 listingId => Agg) private _agg;
    mapping(uint256 listingId => mapping(address user => bool)) public hasReviewed;

    event Reviewed(uint256 indexed listingId, address indexed reviewer, uint8 score, string uri);

    error NotASubscriber();
    error InvalidScore(uint8 score);
    error AlreadyReviewed();
    error ZeroAddress();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address subscriptions_) external initializer {
        __Ownable_init(owner_);
        if (subscriptions_ == address(0)) revert ZeroAddress();
        subscriptions = IFuguSubscription(subscriptions_);
    }

    /// @notice Write a review for an agent (listing).
    /// @param listingId ID of the agent being reviewed.
    /// @param score Score 1-5.
    /// @param uri IPFS URI or metadata URI.
    /// @dev Only a wallet that has paid the agent a meaningful amount
    ///      (`hasSubscribed == true`) can write a review: the agent must have actually
    ///      received at least `minPaidBpsOfPeriod` bps — 50% by default — of the price of
    ///      one full period. Subscribing and cancelling right away grants nothing, and so
    ///      does paying "dust" (subscribe, advance one second, claim, cancel).
    ///      One wallet can review each agent only once.
    function review(uint256 listingId, uint8 score, string calldata uri) external {
        if (score == 0 || score > 5) revert InvalidScore(score);
        if (!subscriptions.hasSubscribed(listingId, msg.sender)) revert NotASubscriber();
        if (hasReviewed[listingId][msg.sender]) revert AlreadyReviewed();

        hasReviewed[listingId][msg.sender] = true;
        Agg storage a = _agg[listingId];
        a.sum += score;
        a.count += 1;

        emit Reviewed(listingId, msg.sender, score, uri);
    }

    function reviewCount(uint256 listingId) external view returns (uint256) {
        return _agg[listingId].count;
    }

    /// @return The average score times 100 (e.g. 450 means 4.50).
    function averageScoreX100(uint256 listingId) external view returns (uint256) {
        Agg memory a = _agg[listingId];
        if (a.count == 0) return 0;
        return (uint256(a.sum) * 100) / a.count;
    }

    function setSubscriptions(address subscriptions_) external onlyOwner {
        if (subscriptions_ == address(0)) revert ZeroAddress();
        subscriptions = IFuguSubscription(subscriptions_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
