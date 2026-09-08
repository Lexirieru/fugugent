// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade one UUPS proxy to a new implementation.
/// @dev How to use: PROXY=0x.. NEW_IMPL=0x.. forge script script/Upgrade.s.sol:Upgrade --rpc-url "$BSC_TESTNET_RPC_URL"
///
///      **ALWAYS run the simulation without `--broadcast` first** and read its output
///      (proxy address, old implementation, new implementation, chain id) before adding
///      `--broadcast`. Pasting the wrong `PROXY` means upgrading the wrong proxy — one of
///      the Fugugent proxies (`FuguSubscription`) holds user funds, so a mistake here is
///      not merely cosmetic.
///
///      `chainId` is hardcoded to 97 (BSC testnet). **Change this value when the script
///      is used for mainnet (BSC = 56).**
contract Upgrade is Script {
    /// @dev EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @dev BSC testnet. Change to 56 for mainnet.
    uint256 constant EXPECTED_CHAIN_ID = 97;

    error ZeroAddress(string label);
    error NoCode(string label, address addr);
    error WrongChain(uint256 expected, uint256 actual);
    error NotUUPSImplementation(address newImpl);
    error WrongProxiableUUID(address newImpl, bytes32 got, bytes32 expected);

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");
        address newImpl = vm.envAddress("NEW_IMPL");

        if (proxy == address(0)) revert ZeroAddress("PROXY");
        if (newImpl == address(0)) revert ZeroAddress("NEW_IMPL");
        if (proxy.code.length == 0) revert NoCode("PROXY", proxy);
        if (newImpl.code.length == 0) revert NoCode("NEW_IMPL", newImpl);

        // ERC-1822 sanity check: a correct UUPS implementation answers `proxiableUUID()`
        // with the ERC-1967 implementation slot. A wrongly pasted contract (e.g. another
        // proxy's address, a non-UUPS contract, or a library) fails here instead of
        // BRICKING the proxy permanently — after `upgradeToAndCall` to an implementation
        // without `_authorizeUpgrade`/`proxiableUUID`, there is no way to upgrade back.
        _assertUUPSImplementation(newImpl);

        address oldImpl = address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));

        console.log("== Upgrade context (verify before broadcasting) ==");
        console.log("chainId          ", block.chainid);
        console.log("proxy            ", proxy);
        console.log("implementation (old)", oldImpl);
        console.log("implementation (new)", newImpl);

        vm.startBroadcast(pk);
        // INIT_DATA is optional: calldata executed INSIDE the proxy's context right after
        // the implementation is swapped. It MUST be set when the new implementation has a
        // `reinitializer` that has to run — for example `initializeV2()` on
        // FuguSubscription, which sets the anti-sybil threshold. Upgrading without it
        // leaves that threshold at zero and the gate dead. Leave it empty only when the
        // new implementation genuinely has no new initializer.
        bytes memory initData = vm.envOr("INIT_DATA", bytes(""));
        if (initData.length == 0) {
            console.log("INIT_DATA is empty - make sure the new implementation has no reinitializer");
        } else {
            console.log("INIT_DATA length:", initData.length);
        }
        UUPSUpgradeable(proxy).upgradeToAndCall(newImpl, initData);
        vm.stopBroadcast();

        address confirmedImpl = address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));
        console.log("== Upgrade result ==");
        console.log("proxy            ", proxy);
        console.log("implementation (now active)", confirmedImpl);
    }

    /// @notice Revert unless `impl` really is a UUPS implementation (ERC-1822).
    /// @dev A raw `staticcall` is used so that a contract lacking this function entirely
    ///      produces our own message, not an unexplained revert.
    function _assertUUPSImplementation(address impl) internal view {
        (bool ok, bytes memory ret) = impl.staticcall(abi.encodeWithSignature("proxiableUUID()"));
        if (!ok || ret.length != 32) revert NotUUPSImplementation(impl);
        bytes32 uuid = abi.decode(ret, (bytes32));
        if (uuid != IMPLEMENTATION_SLOT) revert WrongProxiableUUID(impl, uuid, IMPLEMENTATION_SLOT);
    }
}
