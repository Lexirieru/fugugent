// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Seperti `MockERC20` tapi dengan `decimals()` yang bisa ditentukan — dipakai
///      untuk menguji verifikasi desimal di `FuguPriceOracle.setToken` dan pembulatan
///      quote ke nol.
contract MockERC20Decimals is ERC20 {
    uint8 private immutable _dec;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _dec = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Token yang `decimals()`-nya selalu revert — meniru token non-standar yang tidak
///      mengekspos metadata.
contract MockERC20NoDecimals is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        revert("no decimals");
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
