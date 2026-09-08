// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade satu proxy ke implementasi baru.
/// @dev Jalankan dengan: PROXY=0x.. NEW_IMPL=0x.. forge script script/Upgrade.s.sol:Upgrade --broadcast
contract Upgrade is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");
        address newImpl = vm.envAddress("NEW_IMPL");

        vm.startBroadcast(pk);
        UUPSUpgradeable(proxy).upgradeToAndCall(newImpl, "");
        vm.stopBroadcast();

        console.log("upgraded", proxy, "->", newImpl);
    }
}
