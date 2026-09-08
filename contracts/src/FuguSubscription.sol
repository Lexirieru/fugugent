// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";
import {FuguPriceOracle} from "./FuguPriceOracle.sol";
import {Listing} from "./types/FuguTypes.sol";

/// @title FuguSubscription
/// @notice Escrow for agent subscriptions. An agent can only withdraw in proportion to
///         the time already elapsed, and a user can cancel at any point to take the rest back.
///
/// @dev ## Snapshot asymmetry: `feeBps` is frozen, `treasury` is read live — DELIBERATE
///
///      `feeBps` is snapshotted into `Sub` at `subscribe` time and used as-is on every
///      `claim`, so a rise in `protocolFeeBps` never applies retroactively to a
///      subscription already in flight. That is a **price**: part of the economic deal
///      the user agreed to when paying, so it must not change mid-stream.
///
///      `treasury`, by contrast, is read live from storage at `claim` time. That is a
///      **destination address**, not a price: if the treasury key leaks or the treasury
///      moves to a new multisig, every fee not yet withdrawn must flow to the new address
///      immediately — freezing the old address per subscription would instead send funds
///      to a place that is no longer trusted, and hold the fees from old subscriptions
///      hostage forever.
///
///      The consequence, accepted knowingly: changing `treasury` changes where the fees
///      from existing subscriptions go. That is exactly the intended effect.
contract FuguSubscription is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuard,
    IFuguSubscription
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    struct Sub {
        uint256 listingId;
        address subscriber;
        address payToken;
        uint128 deposited;
        uint128 claimed;
        uint64 startedAt;
        uint64 endsAt;
        bool cancelled;
        // @dev Added at the end of the struct (append-only) — the fee snapshotted at
        //      subscribe time, so a later rise in `protocolFeeBps` does not apply retroactively.
        uint16 feeBps;
    }

    IFuguRegistry public registry;
    FuguPriceOracle public oracle;
    address public treasury;
    uint16 public protocolFeeBps;

    uint256 private _subCount;
    mapping(uint256 subId => Sub) private _subs;
    /// @dev listingId => subscriber => total actually paid out to the agent (via `claim`).
    ///      The source of truth for `hasSubscribed`: subscribe+cancel in the same block
    ///      must not unlock the right to review — only real payment unlocks it.
    mapping(uint256 listingId => mapping(address user => uint256)) private _paidToAgent;
    /// @dev Native payouts that failed to send (push) pile up here to be pulled via
    ///      `withdrawPending`, so a listing owner that is a contract rejecting ETH does
    ///      not lock the agent's share forever.
    mapping(address => uint256) public pendingWithdrawals;

    // --- new state variables (append-only, added at the END) ---

    /// @notice Review-eligibility threshold, in basis points of the price of ONE full period.
    /// @dev 5000 = the agent must have actually received >= 50% of one period's price
    ///      before `hasSubscribed` (and therefore `FuguReputation.review`) opens up.
    ///      Initialized in `initialize` (fresh deploy) or `initializeV2` (an existing
    ///      proxy being upgraded). A value of 0 effectively kills the gate — never leave it 0.
    uint256 public minPaidBpsOfPeriod;

    /// @dev listingId => subscriber => the price of ONE period (in the payment token) at
    ///      the time of that user's first subscription to that listing. Used as the
    ///      denominator of the anti-sybil threshold. Locked to the first value so the
    ///      listing owner cannot later cut the price to make the gate easier, or raise it
    ///      to revoke a review right already earned.
    mapping(uint256 listingId => mapping(address user => uint256)) private _periodPriceRef;

    event Subscribed(
        uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount
    );
    event Claimed(uint256 indexed subId, address indexed to, uint256 amountToOwner, uint256 fee);
    event Cancelled(uint256 indexed subId, uint256 refunded);
    event TreasuryChanged(address treasury);
    event ProtocolFeeChanged(uint16 bps);
    event PayoutDeferred(address indexed to, uint256 amount);
    event MinPaidBpsOfPeriodChanged(uint256 bps);

    error ListingInactive();
    error ZeroPeriods();
    error WrongNativeAmount(uint256 expected, uint256 got);
    error NotSubscriber();
    error AlreadyCancelled();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();
    error NothingToWithdraw();
    error ZeroAmountReceived();
    error DeadlinePassed(uint256 deadline);
    error AmountExceedsMax(uint256 amount, uint256 maxAmount);
    error ZeroAddress();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address registry_, address oracle_, address treasury_, uint16 feeBps_)
        external
        initializer
    {
        __Ownable_init(owner_);
        if (feeBps_ > 2000) revert FeeTooHigh();
        if (registry_ == address(0) || oracle_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        registry = IFuguRegistry(registry_);
        oracle = FuguPriceOracle(oracle_);
        treasury = treasury_;
        protocolFeeBps = feeBps_;
        minPaidBpsOfPeriod = 5000;
    }

    /// @notice Fill in the state variables added after the first deploy.
    /// @dev MUST be called (via `upgradeToAndCall`) when upgrading an existing proxy to
    ///      this version: `minPaidBpsOfPeriod` will never be filled in by an `initialize`
    ///      that has already run, and a value of 0 kills the anti-sybil threshold. It is
    ///      pointless on a fresh deploy (the version 1 initializer already sets it), but
    ///      safe, because `reinitializer(2)` can only run once.
    function initializeV2() external reinitializer(2) {
        minPaidBpsOfPeriod = 5000;
        emit MinPaidBpsOfPeriodChanged(5000);
    }

    /// @notice Subscribe to a listing for `periods` full periods.
    /// @param listingId The listing being subscribed to.
    /// @param periods Number of periods paid up front.
    /// @param payToken Payment token; `address(0)` means the native coin.
    /// @param maxAmount Upper bound on the token amount that may be pulled from the caller.
    /// @param deadline Last timestamp at which this tx may execute.
    /// @dev **Slippage guard.** Final price = `Registry.priceUsd8PerPeriod` x `Oracle.quote()`,
    ///      and BOTH can change between the user signing the tx and the tx landing in a
    ///      block. Without a guard, the listing owner could front-run with `updateListing`
    ///      from $10 to $1000 and drain the user's entire allowance. `maxAmount` is checked
    ///      **before** `safeTransferFrom`, so no funds move before the bound is honored;
    ///      `deadline` kills stale txs that sat in the mempool too long.
    ///      A caller who genuinely does not care about slippage can pass
    ///      `type(uint256).max`, but the UI MUST NOT do that.
    function subscribe(uint256 listingId, uint32 periods, address payToken, uint256 maxAmount, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 subId)
    {
        if (block.timestamp > deadline) revert DeadlinePassed(deadline);
        if (periods == 0) revert ZeroPeriods();
        Listing memory l = registry.getListing(listingId);
        if (!l.active) revert ListingInactive();

        uint256 usdTotal8 = uint256(l.priceUsd8PerPeriod) * periods;
        uint256 amount = oracle.quote(payToken, usdTotal8);

        // A zero amount is rejected on BOTH payment paths (native and ERC-20): a
        // subscription with no payment only produces a confusing empty escrow.
        if (amount == 0) revert ZeroAmountReceived();
        if (amount > maxAmount) revert AmountExceedsMax(amount, maxAmount);

        if (payToken == address(0)) {
            if (msg.value != amount) revert WrongNativeAmount(amount, msg.value);
        } else {
            if (msg.value != 0) revert WrongNativeAmount(0, msg.value);
            // Measure the real balance delta instead of trusting the quoted `amount`, so
            // that fee-on-transfer / rebasing tokens cannot make `deposited` claim more
            // than the contract actually received.
            uint256 balBefore = IERC20(payToken).balanceOf(address(this));
            IERC20(payToken).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(payToken).balanceOf(address(this)) - balBefore;
            if (received == 0) revert ZeroAmountReceived();
            amount = received;
        }

        // One-period price reference for the review-eligibility threshold. Locked on the
        // user's first subscription to this listing and never overwritten afterwards.
        if (_periodPriceRef[listingId][msg.sender] == 0) {
            _periodPriceRef[listingId][msg.sender] = amount / periods;
        }

        subId = ++_subCount;
        uint64 startedAt = uint64(block.timestamp);
        _subs[subId] = Sub({
            listingId: listingId,
            subscriber: msg.sender,
            payToken: payToken,
            deposited: amount.toUint128(),
            claimed: 0,
            startedAt: startedAt,
            endsAt: startedAt + uint64(uint256(l.periodSeconds) * periods),
            cancelled: false,
            feeBps: protocolFeeBps
        });

        emit Subscribed(subId, listingId, msg.sender, payToken, amount);
    }

    function _earned(Sub memory s) internal view returns (uint256) {
        uint256 duration = s.endsAt - s.startedAt;
        if (duration == 0) return s.deposited;
        uint256 nowTs = block.timestamp < s.endsAt ? block.timestamp : s.endsAt;
        uint256 elapsed = nowTs - s.startedAt;
        return (uint256(s.deposited) * elapsed) / duration;
    }

    function claimable(uint256 subId) public view returns (uint256) {
        Sub memory s = _subs[subId];
        return _earned(s) - s.claimed;
    }

    function claim(uint256 subId) external nonReentrant {
        Sub storage s = _subs[subId];
        uint256 amount = _earned(s) - s.claimed;
        if (amount == 0) revert NothingToClaim();
        s.claimed += amount.toUint128();
        // Source of truth for review eligibility: pay first, only then may you rate.
        _paidToAgent[s.listingId][s.subscriber] += amount;

        // The fee comes from the snapshot taken at subscribe time, not from the current
        // `protocolFeeBps`, so a fee rise does not apply retroactively to earnings already accrued.
        uint256 fee = (amount * s.feeBps) / 10_000;
        uint256 toOwner = amount - fee;
        address listingOwner = registry.getListing(s.listingId).owner;

        _payout(s.payToken, listingOwner, toOwner);
        if (fee > 0) _payout(s.payToken, treasury, fee);

        emit Claimed(subId, listingOwner, toOwner, fee);
    }

    function cancel(uint256 subId) external nonReentrant {
        Sub storage s = _subs[subId];
        if (s.subscriber != msg.sender) revert NotSubscriber();
        if (s.cancelled) revert AlreadyCancelled();

        uint256 earned = _earned(s);
        uint256 refund = uint256(s.deposited) - earned;

        s.cancelled = true;
        // stop the agent's share from growing
        if (block.timestamp < s.endsAt) {
            s.endsAt = uint64(block.timestamp);
            s.deposited = earned.toUint128();
        }

        if (refund > 0) _payout(s.payToken, msg.sender, refund);
        emit Cancelled(subId, refund);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            // Push payment: if the recipient rejects ETH (e.g. the listing owner is a
            // contract with no `receive`/`payable fallback`, or refuses on purpose), do
            // NOT revert the whole `claim` — credit `pendingWithdrawals` so the agent's
            // share is not locked forever and can be pulled later via `withdrawPending`.
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) {
                pendingWithdrawals[to] += amount;
                emit PayoutDeferred(to, amount);
            }
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @notice Withdraw native coin that `_payout` failed to send automatically.
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function getSub(uint256 subId) external view returns (Sub memory) {
        return _subs[subId];
    }

    function subCount() external view returns (uint256) {
        return _subCount;
    }

    /// @notice Whether `user` has paid enough to agent `listingId` to earn the right to
    ///         write a review.
    /// @return True if the agent has actually received (via `claim`) at least
    ///         `minPaidBpsOfPeriod` basis points of the price of ONE full period —
    ///         50% by default.
    /// @dev This is an **economic threshold, not an absolute guarantee.** The gate does
    ///      not prove identity and does not prevent sybils; it only makes sybils cost
    ///      real money. Anyone willing to pay half a full period per account can still
    ///      buy a number of review rights — that is the trade-off chosen. What it closes
    ///      is the "dust" attack: the old version only required payment > 0, so
    ///      subscribe -> advance 1 second -> claim -> cancel (about 0.0000039 USDT in
    ///      total for a $10/30-day listing) was enough to unlock the right to review.
    ///
    ///      The denominator is `_periodPriceRef`, the one-period price at the user's FIRST
    ///      subscription to this listing — not the current price — so the listing owner
    ///      cannot move the threshold after the user has paid. If the user has never
    ///      subscribed at all (`_periodPriceRef == 0`), the result is always false.
    function hasSubscribed(uint256 listingId, address user) external view returns (bool) {
        uint256 ref = _periodPriceRef[listingId][user];
        if (ref == 0) return false;
        return _paidToAgent[listingId][user] * 10_000 >= ref * minPaidBpsOfPeriod;
    }

    /// @notice The one-period price used as the denominator of the review-eligibility threshold.
    function periodPriceRef(uint256 listingId, address user) external view returns (uint256) {
        return _periodPriceRef[listingId][user];
    }

    /// @notice Total that has actually flowed to the agent for this pair.
    function paidToAgent(uint256 listingId, address user) external view returns (uint256) {
        return _paidToAgent[listingId][user];
    }

    /// @notice Change the review-eligibility threshold (basis points of one period's price).
    /// @dev 5000 = 50%. Raising this tightens the gate for reviews NOT yet written;
    ///      reviews already recorded in `FuguReputation` are unaffected.
    function setMinPaidBpsOfPeriod(uint256 bps) external onlyOwner {
        minPaidBpsOfPeriod = bps;
        emit MinPaidBpsOfPeriodChanged(bps);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setProtocolFeeBps(uint16 bps) external onlyOwner {
        if (bps > 2000) revert FeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeChanged(bps);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    receive() external payable {}
}
