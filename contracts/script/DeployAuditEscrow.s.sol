// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguAuditEscrow} from "../src/FuguAuditEscrow.sol";

/// @title DeployAuditEscrow
/// @notice Deploys the audit-escrow implementation plus its ERC-1967 proxy.
/// @dev The payment token is fixed at initialize time and has no setter, so it is chosen
///      here once and for good: mUSD, the 18-decimal mock already live on BSC testnet with
///      an open `mint`, so anyone judging this can fund a job without asking us for tokens.
///      Owner and arbiter both start as the deployer; the arbiter is meant to be moved to
///      the attestation-verifying contract with `setArbiter` once that exists.
contract DeployAuditEscrow is Script {
    address constant TOKEN_MUSD = 0x932E82632E80b06318ca969e33F99A54F1a04b10;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        FuguAuditEscrow impl = new FuguAuditEscrow();
        FuguAuditEscrow escrow = FuguAuditEscrow(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FuguAuditEscrow.initialize, (deployer, TOKEN_MUSD, deployer))
                )
            )
        );

        vm.stopBroadcast();

        require(address(escrow.payToken()) == TOKEN_MUSD, "payToken mismatch");
        require(escrow.arbiter() == deployer, "arbiter mismatch");
        require(escrow.owner() == deployer, "owner mismatch");

        console.log("FuguAuditEscrow impl ", address(impl));
        console.log("FuguAuditEscrow proxy", address(escrow));
    }
}
