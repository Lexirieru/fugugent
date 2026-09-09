// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title FuguAuditEscrow
/// @notice Two-sided escrow for the audited-skill marketplace: the skill developer locks
///         the audit FEE, the selected auditor locks an honesty BOND, and the pot is
///         settled one of three ways — released to the auditor for a clean audit, slashed
///         to whoever proves the verdict wrong, or cancelled back to both sides while the
///         job is still half-funded.
///
/// @dev ## Why an escrow at all
///      An agent that installs a poisoned skill drains its own wallet (CVE-2025-54136 tool
///      poisoning, CVE-2025-6514 supply-chain RCE). The only thing that makes an auditor's
///      "SAFE" worth reading is that a wrong verdict costs the auditor money, so the bond
///      must be held by a contract neither party can drain on their own.
///
/// @dev ## Trust boundary — who may move money
///      This contract does NOT judge the audit; it only enforces who is allowed to act on
///      a verdict that was decided elsewhere.
///      - `release` — the developer (accepting the work they paid for) or the `arbiter`
///        (the verdict authority, so a developer who simply goes quiet cannot hold the
///        auditor's bond hostage forever). Never the auditor: a payee who can pay
///        themselves is not an escrow.
///      - `slash` — the `arbiter` only. Slashing is adversarial, so the counterparty who
///        stands to be refunded must not be able to trigger it alone.
///      - `cancel` — either party, and only while the job is still Open.
///      The `arbiter` is an address, not a proof: today it is an operator key, and the
///      production shape is an attestation-verifying contract that only accepts a signed
///      TEE verdict. The owner (a multisig after the hackathon) can move the arbiter and
///      can upgrade this contract, so the owner is trusted with the escrowed funds.
///
/// @dev ## Decimals
///      The escrow never converts or prices anything — it moves whole token units in and
///      the same units back out — so it is decimal-agnostic and needs no oracle. That
///      matters on BSC, where USDT has 18 decimals rather than the usual 6.
contract FuguAuditEscrow is Initializable, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum JobStatus {
        None, // 0 - never created
        Open, // 1 - created, awaiting fee and/or bond
        Funded, // 2 - fee and bond both locked, the audit may start
        Settled, // 3 - clean audit: fee + bond paid to the auditor
        Slashed, // 4 - wrong verdict: bond -> reporter, fee refunded to the developer
        Cancelled // 5 - abandoned before both sides were locked in; each side took its money back

    }

    struct Job {
        address developer; // pays the audit fee, opens the job
        address auditor; // posts the bond, does the work
        uint256 fee; // audit fee ACTUALLY held (see `_pull`)
        uint256 bond; // honesty bond ACTUALLY held
        bool feeFunded;
        bool bondPosted;
        JobStatus status;
        bytes32 skillHash; // the exact skill build under audit; a new build is a new job
    }

    /// @dev Fixed for the life of the proxy on purpose: there is no setter. Swapping the
    ///      payment token while jobs still hold balances would settle those jobs in a
    ///      token the escrow never received, stranding the original deposits. A different
    ///      payment token means a different escrow deployment.
    IERC20 public payToken;

    /// @notice The address allowed to act on an audit verdict (release, and slash).
    address public arbiter;

    uint256 private _jobCount;
    mapping(uint256 jobId => Job) private _jobs;

    event JobCreated(
        uint256 indexed jobId, address indexed developer, address indexed auditor, uint256 fee, uint256 bond, bytes32 skillHash
    );
    event TermsSet(uint256 indexed jobId, uint256 fee, uint256 bond);
    event FeeFunded(uint256 indexed jobId, address indexed from, uint256 amount);
    event BondPosted(uint256 indexed jobId, address indexed from, uint256 amount);
    event JobFunded(uint256 indexed jobId);
    event Released(uint256 indexed jobId, address indexed auditor, uint256 fee, uint256 bond);
    event Slashed(uint256 indexed jobId, address indexed reporter, uint256 bond, address indexed developer, uint256 feeRefunded);
    event Cancelled(uint256 indexed jobId, uint256 feeRefunded, uint256 bondRefunded);
    event ArbiterChanged(address arbiter);

    error ZeroAddress();
    error ZeroAmount();
    error SelfAudit();
    error JobNotOpen();
    error JobNotFunded();
    error FundingStarted();
    error FeeAlreadyFunded();
    error BondAlreadyPosted();
    error NotDeveloper();
    error NotAuditor();
    error NotArbiter();
    error NotAuthorized();
    error ReporterIsAuditor();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address payToken_, address arbiter_) external initializer {
        __Ownable_init(owner_);
        if (payToken_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        payToken = IERC20(payToken_);
        arbiter = arbiter_;
        emit ArbiterChanged(arbiter_);
    }

    /// @notice Open an audit job against a specific skill build, naming the auditor whose
    ///         quote was accepted.
    /// @param auditor The auditor selected out of the quotes.
    /// @param fee The agreed audit fee; may be 0 here and filled in later with `setTerms`.
    /// @param bond The agreed honesty bond; may be 0 here and filled in later.
    /// @param skillHash Content hash of the exact build being audited. A verdict is only
    ///        ever about the bytes that were audited, so an updated skill is a new job —
    ///        this is what makes a clean-v1 / malicious-v2 rug visible.
    /// @dev The caller IS the developer. Letting a caller name someone else as the
    ///      developer would let a stranger open jobs that spend that address's allowance.
    function createJob(address auditor, uint256 fee, uint256 bond, bytes32 skillHash)
        external
        returns (uint256 jobId)
    {
        if (auditor == address(0)) revert ZeroAddress();
        // A developer auditing their own skill can fund, bond and release to themselves at
        // zero net cost, manufacturing a clean audit record. Reject the trivial case.
        if (auditor == msg.sender) revert SelfAudit();

        jobId = ++_jobCount;
        _jobs[jobId] = Job({
            developer: msg.sender,
            auditor: auditor,
            fee: fee,
            bond: bond,
            feeFunded: false,
            bondPosted: false,
            status: JobStatus.Open,
            skillHash: skillHash
        });
        emit JobCreated(jobId, msg.sender, auditor, fee, bond, skillHash);
    }

    /// @notice Write the negotiated price into a job that was opened before the haggling
    ///         finished.
    /// @dev Developer-only, and refused the moment either side has put money in: an
    ///      amount already locked must never be re-labelled under its owner. The auditor
    ///      consents by posting the bond against terms they can read on-chain first.
    function setTerms(uint256 jobId, uint256 fee, uint256 bond) external {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Open) revert JobNotOpen();
        if (msg.sender != j.developer) revert NotDeveloper();
        if (j.feeFunded || j.bondPosted) revert FundingStarted();
        j.fee = fee;
        j.bond = bond;
        emit TermsSet(jobId, fee, bond);
    }

    /// @notice Developer locks the audit fee named in the job's terms.
    /// @dev The amount is NOT a parameter. If it were, anyone could call this with an
    ///      arbitrary number and pull the developer's entire ERC-20 allowance into a job
    ///      of their choosing.
    function fundFee(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Open) revert JobNotOpen();
        if (msg.sender != j.developer) revert NotDeveloper();
        if (j.feeFunded) revert FeeAlreadyFunded();
        if (j.fee == 0) revert ZeroAmount();

        j.feeFunded = true;
        uint256 received = _pull(msg.sender, j.fee);
        j.fee = received;

        emit FeeFunded(jobId, msg.sender, received);
        _markFundedIfComplete(jobId, j);
    }

    /// @notice Selected auditor locks the honesty bond named in the job's terms.
    function postBond(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Open) revert JobNotOpen();
        if (msg.sender != j.auditor) revert NotAuditor();
        if (j.bondPosted) revert BondAlreadyPosted();
        if (j.bond == 0) revert ZeroAmount();

        j.bondPosted = true;
        uint256 received = _pull(msg.sender, j.bond);
        j.bond = received;

        emit BondPosted(jobId, msg.sender, received);
        _markFundedIfComplete(jobId, j);
    }

    /// @notice Clean audit: the fee and the bond both go to the auditor.
    function release(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Funded) revert JobNotFunded();
        if (msg.sender != j.developer && msg.sender != arbiter) revert NotAuthorized();

        j.status = JobStatus.Settled;
        payToken.safeTransfer(j.auditor, j.fee + j.bond);
        emit Released(jobId, j.auditor, j.fee, j.bond);
    }

    /// @notice The verdict was proven wrong: the bond goes to the reporter who proved it
    ///         and the developer gets the fee back.
    /// @dev `reporter` cannot be the auditor — paying a slashed bond back to its owner
    ///      would make the punishment a no-op and let a captured arbiter fake enforcement.
    function slash(uint256 jobId, address reporter) external nonReentrant {
        if (reporter == address(0)) revert ZeroAddress();
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Funded) revert JobNotFunded();
        if (msg.sender != arbiter) revert NotArbiter();
        if (reporter == j.auditor) revert ReporterIsAuditor();

        j.status = JobStatus.Slashed;
        payToken.safeTransfer(reporter, j.bond);
        payToken.safeTransfer(j.developer, j.fee);
        emit Slashed(jobId, reporter, j.bond, j.developer, j.fee);
    }

    /// @notice Abandon a job that never got both sides funded, returning whatever was put in.
    /// @dev Without this, one side funding while the other never shows up locks that money
    ///      in the contract for good: `release` and `slash` both require a fully Funded
    ///      job, so a half-funded job has no other exit. Only reachable while Open, so it
    ///      can never be used to walk out of an audit already under way.
    function cancel(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Open) revert JobNotOpen();
        if (msg.sender != j.developer && msg.sender != j.auditor) revert NotAuthorized();

        uint256 feeRefund = j.feeFunded ? j.fee : 0;
        uint256 bondRefund = j.bondPosted ? j.bond : 0;

        j.status = JobStatus.Cancelled;
        j.feeFunded = false;
        j.bondPosted = false;

        if (feeRefund > 0) payToken.safeTransfer(j.developer, feeRefund);
        if (bondRefund > 0) payToken.safeTransfer(j.auditor, bondRefund);
        emit Cancelled(jobId, feeRefund, bondRefund);
    }

    /// @notice Full job state in one call, for the marketplace UI and the indexer.
    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function jobCount() external view returns (uint256) {
        return _jobCount;
    }

    /// @notice Point the escrow at a new verdict authority.
    /// @dev The intended path from an operator key to the attestation-verifying contract.
    function setArbiter(address arbiter_) external onlyOwner {
        if (arbiter_ == address(0)) revert ZeroAddress();
        arbiter = arbiter_;
        emit ArbiterChanged(arbiter_);
    }

    /// @dev Book the balance the contract ACTUALLY received, not the amount requested. A
    ///      fee-on-transfer token delivers less than it is asked for, and an escrow that
    ///      credits the requested amount would later pay a job out of a different job's
    ///      deposit — the last job to settle would find the vault empty.
    function _pull(address from, uint256 amount) internal returns (uint256 received) {
        IERC20 t = payToken;
        uint256 balBefore = t.balanceOf(address(this));
        t.safeTransferFrom(from, address(this), amount);
        received = t.balanceOf(address(this)) - balBefore;
        if (received == 0) revert ZeroAmount();
    }

    function _markFundedIfComplete(uint256 jobId, Job storage j) internal {
        if (j.feeFunded && j.bondPosted) {
            j.status = JobStatus.Funded;
            emit JobFunded(jobId);
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
