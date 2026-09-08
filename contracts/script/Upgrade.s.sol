// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade satu proxy UUPS ke implementasi baru.
/// @dev Cara pakai: PROXY=0x.. NEW_IMPL=0x.. forge script script/Upgrade.s.sol:Upgrade --rpc-url "$BSC_TESTNET_RPC_URL"
///
///      **SELALU jalankan simulasi tanpa `--broadcast` terlebih dahulu** dan baca
///      keluarannya (alamat proxy, implementasi lama, implementasi baru, chain id)
///      sebelum menambahkan `--broadcast`. Salah menempelkan `PROXY` berarti
///      meng-upgrade proxy yang salah — salah satu proxy Fugugent (`FuguSubscription`)
///      memegang dana user, jadi kesalahan di sini bukan sekadar kesalahan kosmetik.
///
///      `chainId` di-hardcode ke 97 (BSC testnet). **Ubah nilai ini saat script
///      dipakai untuk mainnet (BSC = 56).**
contract Upgrade is Script {
    /// @dev Slot implementasi EIP-1967: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1)
    bytes32 constant IMPLEMENTATION_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /// @dev BSC testnet. Ganti ke 56 untuk mainnet.
    uint256 constant EXPECTED_CHAIN_ID = 97;

    error ZeroAddress(string label);
    error NoCode(string label, address addr);
    error WrongChain(uint256 expected, uint256 actual);

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");
        address newImpl = vm.envAddress("NEW_IMPL");

        if (proxy == address(0)) revert ZeroAddress("PROXY");
        if (newImpl == address(0)) revert ZeroAddress("NEW_IMPL");
        if (proxy.code.length == 0) revert NoCode("PROXY", proxy);
        if (newImpl.code.length == 0) revert NoCode("NEW_IMPL", newImpl);

        address oldImpl = address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));

        console.log("== Upgrade context (verify before broadcasting) ==");
        console.log("chainId          ", block.chainid);
        console.log("proxy            ", proxy);
        console.log("implementation (old)", oldImpl);
        console.log("implementation (new)", newImpl);

        vm.startBroadcast(pk);
        UUPSUpgradeable(proxy).upgradeToAndCall(newImpl, "");
        vm.stopBroadcast();

        address confirmedImpl = address(uint160(uint256(vm.load(proxy, IMPLEMENTATION_SLOT))));
        console.log("== Upgrade result ==");
        console.log("proxy            ", proxy);
        console.log("implementation (now active)", confirmedImpl);
    }
}
