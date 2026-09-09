// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FuguAuditEscrow} from "../../src/FuguAuditEscrow.sol";

/// @dev Adds a NEW state variable AT THE END — the append-only pattern.
contract FuguAuditEscrowV2 is FuguAuditEscrow {
    uint256 public extraField;

    function setExtraField(uint256 v) external {
        extraField = v;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
