// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockToken
/// @notice Token ERC-20 18 desimal dengan `mint` terbuka, untuk pengujian di testnet.
/// @dev Kontrak uji, bukan bagian produk: tidak upgradeable, tidak ada `__gap`.
contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    /// @notice Mint bebas akses — kontrak ini hanya dipakai di testnet untuk simulasi.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
