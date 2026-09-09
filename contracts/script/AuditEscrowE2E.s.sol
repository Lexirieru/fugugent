// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {FuguAuditEscrow} from "../src/FuguAuditEscrow.sol";

/// @title AuditEscrowE2E
/// @notice Drives one real job through the full happy path on BSC testnet:
///         createJob -> fundFee -> postBond -> release.
/// @dev Two distinct signers are required by design — the escrow refuses a job whose
///      developer and auditor are the same address — so the auditor is a deterministic
///      test key (derived here, not a secret, testnet only) that the deployer tops up with
///      a small gas stipend, the same pattern `DeployMocks` uses for its liquidity
///      provider. Amounts are deliberately tiny: this proves the flow, not a market.
contract AuditEscrowE2E is Script {
    uint256 constant FEE = 5e18; // 5 mUSD
    uint256 constant BOND = 2e18; // 2 mUSD
    uint256 constant AUDITOR_GAS_STIPEND = 0.002 ether;

    function run() external {
        uint256 devPk = vm.envUint("PRIVATE_KEY");
        address developer = vm.addr(devPk);
        FuguAuditEscrow escrow = FuguAuditEscrow(vm.envAddress("ESCROW_ADDRESS"));
        MockToken musd = MockToken(address(escrow.payToken()));

        uint256 auditorPk = uint256(keccak256("fugu-audit-escrow-auditor-testnet-seed"));
        address auditor = vm.addr(auditorPk);
        bytes32 skillHash = keccak256("skill://fugu-grid-price-checker@1.0.0");

        // --- developer side: fund both wallets, open the job, lock the fee
        vm.startBroadcast(devPk);
        musd.mint(developer, FEE);
        musd.mint(auditor, BOND);
        if (auditor.balance < AUDITOR_GAS_STIPEND) {
            (bool sentGas,) = payable(auditor).call{value: AUDITOR_GAS_STIPEND}("");
            require(sentGas, "gas stipend to auditor failed");
        }
        IERC20(address(musd)).approve(address(escrow), FEE);
        uint256 jobId = escrow.createJob(auditor, FEE, BOND, skillHash);
        escrow.fundFee(jobId);
        vm.stopBroadcast();

        // --- auditor side: lock the bond
        vm.startBroadcast(auditorPk);
        IERC20(address(musd)).approve(address(escrow), BOND);
        escrow.postBond(jobId);
        vm.stopBroadcast();

        require(uint8(escrow.getJob(jobId).status) == uint8(FuguAuditEscrow.JobStatus.Funded), "not funded");
        uint256 auditorBalBefore = musd.balanceOf(auditor);

        // --- clean verdict: the developer releases fee + bond to the auditor
        vm.startBroadcast(devPk);
        escrow.release(jobId);
        vm.stopBroadcast();

        FuguAuditEscrow.Job memory j = escrow.getJob(jobId);
        require(uint8(j.status) == uint8(FuguAuditEscrow.JobStatus.Settled), "not settled");
        require(musd.balanceOf(auditor) == auditorBalBefore + FEE + BOND, "auditor not paid");

        console.log("jobId       ", jobId);
        console.log("developer   ", developer);
        console.log("auditor     ", auditor);
        console.log("fee         ", j.fee);
        console.log("bond        ", j.bond);
        console.log("status      ", uint8(j.status));
        console.log("auditor mUSD", musd.balanceOf(auditor));
    }
}
