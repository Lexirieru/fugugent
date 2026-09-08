// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IFuguSubscription {
    function hasSubscribed(uint256 listingId, address user) external view returns (bool);
}
