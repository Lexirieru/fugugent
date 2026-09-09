// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FuguAuditEscrow} from "../src/FuguAuditEscrow.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC20ReturnsFalse, MockERC20FeeOnTransfer, MockERC20Reentrant} from "./mocks/MockERC20Hostile.sol";

contract FuguAuditEscrowTest is Test {
    FuguAuditEscrow escrow;
    MockERC20 token;

    address owner = address(0xA11CE);
    address arbiter = address(0xA2B1);
    address developer = address(0xDE7);
    address auditor = address(0xAD17);
    address reporter = address(0x9E90);
    address stranger = address(0xBAD);

    bytes32 constant SKILL = keccak256("skill://price-checker@1.0.0");

    uint256 constant FEE = 100e18;
    uint256 constant BOND = 40e18;

    function setUp() public {
        token = new MockERC20("Mock USD", "mUSD");
        escrow = _deployEscrow(address(token));

        token.mint(developer, 1_000e18);
        token.mint(auditor, 1_000e18);
        vm.prank(developer);
        token.approve(address(escrow), type(uint256).max);
        vm.prank(auditor);
        token.approve(address(escrow), type(uint256).max);
    }

    function _deployEscrow(address payToken) internal returns (FuguAuditEscrow) {
        FuguAuditEscrow impl = new FuguAuditEscrow();
        return FuguAuditEscrow(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(FuguAuditEscrow.initialize, (owner, payToken, arbiter))
                )
            )
        );
    }

    function _openJob() internal returns (uint256 jobId) {
        vm.prank(developer);
        jobId = escrow.createJob(auditor, FEE, BOND, SKILL);
    }

    function _fundedJob() internal returns (uint256 jobId) {
        jobId = _openJob();
        vm.prank(developer);
        escrow.fundFee(jobId);
        vm.prank(auditor);
        escrow.postBond(jobId);
    }

    // ---------------------------------------------------------------------
    // Happy path — terms -> fund -> bond -> release
    // ---------------------------------------------------------------------

    function test_happyPathTermsFundBondRelease() public {
        vm.prank(developer);
        uint256 jobId = escrow.createJob(auditor, 0, 0, SKILL);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Open));

        vm.prank(developer);
        escrow.setTerms(jobId, FEE, BOND);
        assertEq(escrow.getJob(jobId).fee, FEE);
        assertEq(escrow.getJob(jobId).bond, BOND);

        uint256 devBefore = token.balanceOf(developer);
        uint256 audBefore = token.balanceOf(auditor);

        vm.prank(developer);
        escrow.fundFee(jobId);
        assertTrue(escrow.getJob(jobId).feeFunded);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Open));

        vm.prank(auditor);
        escrow.postBond(jobId);
        assertTrue(escrow.getJob(jobId).bondPosted);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Funded));
        assertEq(token.balanceOf(address(escrow)), FEE + BOND);

        vm.prank(developer);
        escrow.release(jobId);

        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Settled));
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(token.balanceOf(developer), devBefore - FEE);
        assertEq(token.balanceOf(auditor), audBefore + FEE);
    }

    function test_arbiterCanRelease() public {
        uint256 jobId = _fundedJob();
        vm.prank(arbiter);
        escrow.release(jobId);
        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Settled));
    }

    function test_getJobOfUnknownIdIsEmpty() public view {
        FuguAuditEscrow.Job memory j = escrow.getJob(999);
        assertEq(uint8(j.status), uint8(FuguAuditEscrow.JobStatus.None));
        assertEq(j.developer, address(0));
    }

    function test_jobCountIncrements() public {
        assertEq(escrow.jobCount(), 0);
        _openJob();
        _openJob();
        assertEq(escrow.jobCount(), 2);
    }

    // ---------------------------------------------------------------------
    // Slash — the money must reach the reporter and the developer, nobody else
    // ---------------------------------------------------------------------

    function test_slashPaysReporterAndRefundsDeveloper() public {
        uint256 jobId = _fundedJob();
        uint256 devBefore = token.balanceOf(developer);

        vm.prank(arbiter);
        escrow.slash(jobId, reporter);

        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Slashed));
        assertEq(token.balanceOf(reporter), BOND);
        assertEq(token.balanceOf(developer), devBefore + FEE);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_slashRejectsZeroReporter() public {
        uint256 jobId = _fundedJob();
        vm.prank(arbiter);
        vm.expectRevert(FuguAuditEscrow.ZeroAddress.selector);
        escrow.slash(jobId, address(0));
    }

    /// @notice Paying the bond back to the auditor being slashed would make the punishment
    ///         a no-op, so the auditor may never be the reporter.
    function test_slashRejectsAuditorAsReporter() public {
        uint256 jobId = _fundedJob();
        vm.prank(arbiter);
        vm.expectRevert(FuguAuditEscrow.ReporterIsAuditor.selector);
        escrow.slash(jobId, auditor);
    }

    // ---------------------------------------------------------------------
    // Access control — the whole point of an escrow
    // ---------------------------------------------------------------------

    function test_strangerCannotRelease() public {
        uint256 jobId = _fundedJob();
        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotAuthorized.selector);
        escrow.release(jobId);
    }

    /// @notice The auditor releasing to themselves would turn the escrow into a
    ///         self-service withdrawal: the audit could be skipped entirely.
    function test_auditorCannotRelease() public {
        uint256 jobId = _fundedJob();
        vm.prank(auditor);
        vm.expectRevert(FuguAuditEscrow.NotAuthorized.selector);
        escrow.release(jobId);
    }

    /// @notice A permissionless `slash` lets anyone name themselves the reporter and walk
    ///         off with the auditor's bond.
    function test_strangerCannotSlash() public {
        uint256 jobId = _fundedJob();
        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotArbiter.selector);
        escrow.slash(jobId, stranger);
    }

    /// @notice Slashing is adversarial, so even the paying developer cannot do it alone —
    ///         only the verdict authority can.
    function test_developerCannotSlash() public {
        uint256 jobId = _fundedJob();
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.NotArbiter.selector);
        escrow.slash(jobId, reporter);
    }

    /// @notice `fundFee` taking the amount from the caller lets a stranger drain the whole
    ///         allowance the developer granted this escrow.
    function test_strangerCannotFundFee() public {
        uint256 jobId = _openJob();
        uint256 devBefore = token.balanceOf(developer);

        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotDeveloper.selector);
        escrow.fundFee(jobId);

        assertFalse(escrow.getJob(jobId).feeFunded);
        // the developer's standing allowance to this escrow was not touched
        assertEq(token.balanceOf(developer), devBefore);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_strangerCannotPostBond() public {
        uint256 jobId = _openJob();
        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotAuditor.selector);
        escrow.postBond(jobId);
        assertFalse(escrow.getJob(jobId).bondPosted);
    }

    /// @notice Anyone able to rewrite the terms could set the bond to dust just before the
    ///         auditor posts it, or the fee to zero just before the developer funds it.
    function test_strangerCannotSetTerms() public {
        uint256 jobId = _openJob();
        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotDeveloper.selector);
        escrow.setTerms(jobId, 1, 1);
        assertEq(escrow.getJob(jobId).fee, FEE);
    }

    function test_setTermsRejectedOnceFundingStarted() public {
        uint256 jobId = _openJob();
        vm.prank(developer);
        escrow.fundFee(jobId);

        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.FundingStarted.selector);
        escrow.setTerms(jobId, 1, 1);
    }

    function test_onlyOwnerCanSetArbiter() public {
        vm.prank(stranger);
        vm.expectRevert();
        escrow.setArbiter(stranger);

        vm.prank(owner);
        escrow.setArbiter(address(0xC0DE));
        assertEq(escrow.arbiter(), address(0xC0DE));
    }

    function test_setArbiterRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert(FuguAuditEscrow.ZeroAddress.selector);
        escrow.setArbiter(address(0));
    }

    // ---------------------------------------------------------------------
    // Double calls and stale-state calls
    // ---------------------------------------------------------------------

    function test_fundFeeTwiceReverts() public {
        uint256 jobId = _openJob();
        vm.startPrank(developer);
        escrow.fundFee(jobId);
        vm.expectRevert(FuguAuditEscrow.FeeAlreadyFunded.selector);
        escrow.fundFee(jobId);
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), FEE);
    }

    function test_postBondTwiceReverts() public {
        uint256 jobId = _openJob();
        vm.startPrank(auditor);
        escrow.postBond(jobId);
        vm.expectRevert(FuguAuditEscrow.BondAlreadyPosted.selector);
        escrow.postBond(jobId);
        vm.stopPrank();
        assertEq(token.balanceOf(address(escrow)), BOND);
    }

    function test_fundingAfterSettlementReverts() public {
        uint256 jobId = _fundedJob();
        vm.prank(developer);
        escrow.release(jobId);

        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.JobNotOpen.selector);
        escrow.fundFee(jobId);

        vm.prank(auditor);
        vm.expectRevert(FuguAuditEscrow.JobNotOpen.selector);
        escrow.postBond(jobId);
    }

    function test_releaseTwiceReverts() public {
        uint256 jobId = _fundedJob();
        vm.startPrank(developer);
        escrow.release(jobId);
        vm.expectRevert(FuguAuditEscrow.JobNotFunded.selector);
        escrow.release(jobId);
        vm.stopPrank();
    }

    function test_slashAfterReleaseReverts() public {
        uint256 jobId = _fundedJob();
        vm.prank(developer);
        escrow.release(jobId);
        vm.prank(arbiter);
        vm.expectRevert(FuguAuditEscrow.JobNotFunded.selector);
        escrow.slash(jobId, reporter);
    }

    function test_releaseOfHalfFundedJobReverts() public {
        uint256 jobId = _openJob();
        vm.prank(developer);
        escrow.fundFee(jobId);
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.JobNotFunded.selector);
        escrow.release(jobId);
    }

    // ---------------------------------------------------------------------
    // Job creation guards
    // ---------------------------------------------------------------------

    function test_createJobRejectsZeroAuditor() public {
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.ZeroAddress.selector);
        escrow.createJob(address(0), FEE, BOND, SKILL);
    }

    /// @notice Auditing your own skill and releasing to yourself is a wash trade that
    ///         manufactures a clean audit record for free.
    function test_createJobRejectsSelfAudit() public {
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.SelfAudit.selector);
        escrow.createJob(developer, FEE, BOND, SKILL);
    }

    function test_cannotFundZeroFee() public {
        vm.prank(developer);
        uint256 jobId = escrow.createJob(auditor, 0, BOND, SKILL);
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.ZeroAmount.selector);
        escrow.fundFee(jobId);
    }

    function test_cannotPostZeroBond() public {
        vm.prank(developer);
        uint256 jobId = escrow.createJob(auditor, FEE, 0, SKILL);
        vm.prank(auditor);
        vm.expectRevert(FuguAuditEscrow.ZeroAmount.selector);
        escrow.postBond(jobId);
    }

    // ---------------------------------------------------------------------
    // Cancel — without it, a job only one side funded locks that money forever
    // ---------------------------------------------------------------------

    function test_cancelRefundsBothSides() public {
        uint256 jobId = _openJob();
        vm.prank(developer);
        escrow.fundFee(jobId);

        uint256 devBefore = token.balanceOf(developer);
        vm.prank(developer);
        escrow.cancel(jobId);

        assertEq(uint8(escrow.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Cancelled));
        assertEq(token.balanceOf(developer), devBefore + FEE);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function test_auditorCanCancelAndRecoverBond() public {
        uint256 jobId = _openJob();
        vm.prank(auditor);
        escrow.postBond(jobId);

        uint256 audBefore = token.balanceOf(auditor);
        vm.prank(auditor);
        escrow.cancel(jobId);
        assertEq(token.balanceOf(auditor), audBefore + BOND);
    }

    function test_strangerCannotCancel() public {
        uint256 jobId = _openJob();
        vm.prank(stranger);
        vm.expectRevert(FuguAuditEscrow.NotAuthorized.selector);
        escrow.cancel(jobId);
    }

    /// @notice Once both sides are locked in, the audit is underway: no unilateral exit.
    function test_cannotCancelFundedJob() public {
        uint256 jobId = _fundedJob();
        vm.prank(developer);
        vm.expectRevert(FuguAuditEscrow.JobNotOpen.selector);
        escrow.cancel(jobId);
    }

    function test_cancelTwiceReverts() public {
        uint256 jobId = _openJob();
        vm.startPrank(developer);
        escrow.fundFee(jobId);
        escrow.cancel(jobId);
        vm.expectRevert(FuguAuditEscrow.JobNotOpen.selector);
        escrow.cancel(jobId);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Hostile tokens
    // ---------------------------------------------------------------------

    /// @notice A token that answers `false` must never leave a job believing it is funded.
    function test_falseReturningTokenLeavesJobUnfunded() public {
        MockERC20ReturnsFalse liar = new MockERC20ReturnsFalse();
        FuguAuditEscrow e = _deployEscrow(address(liar));
        liar.mint(developer, 1_000e18);

        vm.startPrank(developer);
        liar.approve(address(e), type(uint256).max);
        uint256 jobId = e.createJob(auditor, FEE, BOND, SKILL);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(liar)));
        e.fundFee(jobId);
        vm.stopPrank();

        assertFalse(e.getJob(jobId).feeFunded);
        assertEq(uint8(e.getJob(jobId).status), uint8(FuguAuditEscrow.JobStatus.Open));
        assertEq(liar.balanceOf(address(e)), 0);
    }

    /// @notice With a fee-on-transfer token the escrow must book what it actually received,
    ///         never the amount that was asked for — otherwise one job pays itself out of
    ///         another job's money and the last job to settle finds an empty vault.
    function test_feeOnTransferBooksOnlyWhatArrived() public {
        MockERC20FeeOnTransfer fot = new MockERC20FeeOnTransfer(100); // 1%
        FuguAuditEscrow e = _deployEscrow(address(fot));
        fot.mint(developer, 1_000e18);
        fot.mint(auditor, 1_000e18);

        vm.prank(developer);
        fot.approve(address(e), type(uint256).max);
        vm.prank(auditor);
        fot.approve(address(e), type(uint256).max);

        vm.prank(developer);
        uint256 jobId = e.createJob(auditor, FEE, BOND, SKILL);
        vm.prank(developer);
        e.fundFee(jobId);
        vm.prank(auditor);
        e.postBond(jobId);

        FuguAuditEscrow.Job memory j = e.getJob(jobId);
        assertEq(j.fee, (FEE * 99) / 100);
        assertEq(j.bond, (BOND * 99) / 100);
        assertEq(fot.balanceOf(address(e)), j.fee + j.bond);

        vm.prank(developer);
        e.release(jobId);
        assertEq(fot.balanceOf(address(e)), 0);
    }

    /// @notice Two jobs share one vault: settling one must never dip into the other's money.
    function test_settlingOneJobLeavesTheOtherFullyFunded() public {
        uint256 jobA = _fundedJob();
        uint256 jobB = _fundedJob();
        assertEq(token.balanceOf(address(escrow)), 2 * (FEE + BOND));

        vm.prank(developer);
        escrow.release(jobA);
        assertEq(token.balanceOf(address(escrow)), FEE + BOND);

        vm.prank(arbiter);
        escrow.slash(jobB, reporter);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    /// @notice A payout token with a transfer hook must not be able to re-enter the escrow
    ///         while a settlement is still in flight.
    function test_reentrantTokenCannotReenterDuringRelease() public {
        MockERC20Reentrant hook = new MockERC20Reentrant();
        FuguAuditEscrow e = _deployEscrow(address(hook));
        hook.mint(developer, 1_000e18);
        hook.mint(auditor, 1_000e18);

        vm.prank(developer);
        hook.approve(address(e), type(uint256).max);
        vm.prank(auditor);
        hook.approve(address(e), type(uint256).max);

        vm.prank(developer);
        uint256 jobA = e.createJob(auditor, FEE, BOND, SKILL);
        vm.prank(developer);
        uint256 jobB = e.createJob(auditor, FEE, BOND, SKILL);
        for (uint256 i = 1; i <= 2; i++) {
            vm.prank(developer);
            e.fundFee(i);
            vm.prank(auditor);
            e.postBond(i);
        }

        // While job A pays out, the token hook tries to settle job B from inside the call.
        hook.arm(address(e), abi.encodeCall(FuguAuditEscrow.release, (jobB)));

        vm.prank(developer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        e.release(jobA);

        // nothing moved: both jobs are still funded and the vault is still whole
        assertEq(uint8(e.getJob(jobA).status), uint8(FuguAuditEscrow.JobStatus.Funded));
        assertEq(uint8(e.getJob(jobB).status), uint8(FuguAuditEscrow.JobStatus.Funded));
        assertEq(hook.balanceOf(address(e)), 2 * (FEE + BOND));
    }

    // ---------------------------------------------------------------------
    // Proxy hygiene
    // ---------------------------------------------------------------------

    function test_implementationCannotBeInitialized() public {
        FuguAuditEscrow impl = new FuguAuditEscrow();
        vm.expectRevert();
        impl.initialize(owner, address(token), arbiter);
    }

    function test_initializeRejectsZeroAddresses() public {
        FuguAuditEscrow impl = new FuguAuditEscrow();

        vm.expectRevert(FuguAuditEscrow.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FuguAuditEscrow.initialize, (owner, address(0), arbiter)));

        vm.expectRevert(FuguAuditEscrow.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(FuguAuditEscrow.initialize, (owner, address(token), address(0))));
    }

    function test_nonOwnerCannotUpgrade() public {
        FuguAuditEscrow impl = new FuguAuditEscrow();
        vm.prank(stranger);
        vm.expectRevert();
        escrow.upgradeToAndCall(address(impl), "");
    }
}
