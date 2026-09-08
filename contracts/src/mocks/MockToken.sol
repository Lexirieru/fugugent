// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockToken
/// @notice An 18-decimal ERC-20 token with open `mint`, for testing on testnet.
/// @dev A test contract, not part of the product: not upgradeable, no `__gap`.
contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Unrestricted mint — this contract is only used on testnet for simulation.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
