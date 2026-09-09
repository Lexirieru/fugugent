// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev A token that silently answers `false` instead of reverting — the historical
///      ZRX/EURS behaviour. Any escrow that ignores the return value of `transfer` /
///      `transferFrom` will believe it has been paid while no balance moved at all.
contract MockERC20ReturnsFalse is ERC20 {
    constructor() ERC20("Liar", "LIAR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) public pure override returns (bool) {
        return false;
    }
}

/// @dev A token that keeps `feeBps` of every transfer. The recipient always receives less
///      than the amount named in the call, so any accounting that trusts the *requested*
///      amount ends up crediting money the contract never received.
contract MockERC20FeeOnTransfer is ERC20 {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) ERC20("Fee On Transfer", "FOT") {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, address(0xFEE), fee);
        super._update(from, to, value - fee);
    }
}

/// @dev A token that calls back into an arbitrary target on every transfer — the ERC-777
///      / hook-token shape. It is the tool used to prove that a payout function cannot be
///      re-entered while its own state update is still half-written.
contract MockERC20Reentrant is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;

    constructor() ERC20("Hook", "HOOK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    /// @dev Fires once: the re-entrant call must not itself re-arm the hook, otherwise the
    ///      test would recurse until it ran out of gas and prove nothing.
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0)) {
            armed = false;
            (bool ok, bytes memory ret) = target.call(payload);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
