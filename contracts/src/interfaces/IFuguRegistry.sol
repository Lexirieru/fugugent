// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Listing} from "../types/FuguTypes.sol";

interface IFuguRegistry {
    function getListing(uint256 listingId) external view returns (Listing memory);
    function listingCount() external view returns (uint256);

    /// @notice The listing that has claimed an ERC-8004 identity, or 0 if none has.
    function listingByAgentId(uint256 erc8004AgentId) external view returns (uint256);

    /// @notice The ERC-8004 IdentityRegistry ownership is checked against;
    ///         `address(0)` when not configured.
    function identityRegistry() external view returns (address);

    /// @notice Move a listing onto a different ERC-8004 identity the caller owns,
    ///         leaving every other field of the listing untouched.
    function rebindAgentId(uint256 listingId, uint256 newErc8004AgentId) external;
}
