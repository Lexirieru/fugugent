// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FuguSubscription} from "../../src/FuguSubscription.sol";

/// @dev Adds a NEW state variable AT THE END — the append-only pattern.
contract FuguSubscriptionV2 is FuguSubscription {
    uint256 public extraField;

    function setExtraField(uint256 v) external {
        extraField = v;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
