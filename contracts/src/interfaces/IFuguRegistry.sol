// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Listing} from "../types/FuguTypes.sol";

interface IFuguRegistry {
    function getListing(uint256 listingId) external view returns (Listing memory);
    function listingCount() external view returns (uint256);
}
