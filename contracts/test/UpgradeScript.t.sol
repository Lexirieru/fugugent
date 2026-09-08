// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Upgrade} from "../script/Upgrade.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @dev Membuka `_assertUUPSImplementation` yang internal supaya bisa diuji tanpa
///      menyentuh `run()` (yang butuh env var dan melakukan broadcast).
contract UpgradeHarness is Upgrade {
    function assertUUPS(address impl) external view {
        _assertUUPSImplementation(impl);
    }
}

/// @dev Kontrak yang menjawab `proxiableUUID()` tapi dengan slot yang salah.
contract WrongUUIDImpl {
    function proxiableUUID() external pure returns (bytes32) {
        return bytes32(uint256(1));
    }
}

/// @notice Butir 9 — `Upgrade.s.sol` harus menolak implementasi yang salah tempel
///         SEBELUM `upgradeToAndCall`, karena upgrade ke kontrak non-UUPS mem-brick
///         proxy secara permanen (tidak ada jalan upgrade kembali).
contract UpgradeScriptTest is Test {
    UpgradeHarness harness;

    function setUp() public {
        harness = new UpgradeHarness();
    }

    function test_acceptsRealUUPSImplementation() public {
        harness.assertUUPS(address(new FuguRegistry()));
    }

    function test_rejectsImplementationWithoutProxiableUUID() public {
        address notUups = address(new MockERC20("Nope", "NOPE"));
        vm.expectRevert(abi.encodeWithSelector(Upgrade.NotUUPSImplementation.selector, notUups));
        harness.assertUUPS(notUups);
    }

    function test_rejectsEOAPastedAsImplementation() public {
        vm.expectRevert(abi.encodeWithSelector(Upgrade.NotUUPSImplementation.selector, address(0xDEAD)));
        harness.assertUUPS(address(0xDEAD));
    }

    /// @notice Kesalahan paling mudah dilakukan: menempelkan alamat PROXY ke `NEW_IMPL`.
    ///         Proxy menolak `proxiableUUID()` (modifier `notDelegated`), jadi tertangkap.
    function test_rejectsProxyPastedAsImplementation() public {
        FuguRegistry impl = new FuguRegistry();
        address proxy = address(
            new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (address(this))))
        );
        vm.expectRevert(abi.encodeWithSelector(Upgrade.NotUUPSImplementation.selector, proxy));
        harness.assertUUPS(proxy);
    }

    function test_rejectsWrongProxiableUUID() public {
        address wrong = address(new WrongUUIDImpl());
        vm.expectRevert(
            abi.encodeWithSelector(
                Upgrade.WrongProxiableUUID.selector,
                wrong,
                bytes32(uint256(1)),
                bytes32(0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc)
            )
        );
        harness.assertUUPS(wrong);
    }
}
