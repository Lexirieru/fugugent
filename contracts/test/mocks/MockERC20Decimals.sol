// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Like `MockERC20` but with a settable `decimals()` — used to test the decimals
///      verification in `FuguPriceOracle.setToken` and quotes that round down to zero.
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

/// @dev A token whose `decimals()` always reverts — imitates a non-standard token that
///      exposes no metadata.
contract MockERC20NoDecimals is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        revert("no decimals");
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
