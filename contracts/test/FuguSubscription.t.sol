// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {Category} from "../src/types/FuguTypes.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockERC20Decimals} from "./mocks/MockERC20Decimals.sol";

contract FuguSubscriptionTest is Test {
    FuguRegistry registry;
    FuguPriceOracle oracle;
    FuguSubscription subs;
    MockERC20 usdt;
    MockAggregator usdtFeed;

    address owner = address(0xA11CE);
    address treasury = address(0x7EA);
    address creator = address(0xC0FFEE);
    address user = address(0x5E1);

    uint256 listingId;

    function setUp() public {
        vm.warp(1_700_000_000);

        FuguRegistry rImpl = new FuguRegistry();
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(rImpl), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );

        FuguPriceOracle oImpl = new FuguPriceOracle();
        oracle = FuguPriceOracle(
            address(new ERC1967Proxy(address(oImpl), abi.encodeCall(FuguPriceOracle.initialize, (owner))))
        );

        FuguSubscription sImpl = new FuguSubscription();
        subs = FuguSubscription(
            payable(address(new ERC1967Proxy(
                address(sImpl),
                abi.encodeCall(FuguSubscription.initialize, (owner, address(registry), address(oracle), treasury, 500))
            )))
        );

        usdt = new MockERC20("Tether", "USDT");
        usdtFeed = new MockAggregator(8, 1_00000000);

        vm.startPrank(owner);
        oracle.setToken(
            address(usdt),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(usdtFeed),
                maxStaleness: 90000,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        vm.stopPrank();

        // listing: $10 per 30 days
        vm.prank(creator);
        listingId = registry.list(1, address(0xA6E17), Category.GRID, 10_00000000, 30 days, "");

        usdt.mint(user, 1000e18);
        vm.prank(user);
        usdt.approve(address(subs), type(uint256).max);
    }

    function _subscribeOnePeriod() internal returns (uint256) {
        vm.prank(user);
        return subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);
    }

    function test_subscribePullsCorrectTokenAmount() public {
        uint256 before = usdt.balanceOf(user);
        _subscribeOnePeriod();
        // $10 at a $1 peg = 10 tokens
        assertEq(before - usdt.balanceOf(user), 10e18);
        assertEq(usdt.balanceOf(address(subs)), 10e18);
    }

    function test_nothingClaimableImmediately() public {
        uint256 id = _subscribeOnePeriod();
        assertEq(subs.claimable(id), 0);
    }

    function test_halfClaimableAtHalfPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        assertEq(subs.claimable(id), 5e18);
    }

    function test_allClaimableAfterPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 31 days);
        assertEq(subs.claimable(id), 10e18);
    }

    function test_claimSplitsRevenueWithTreasury() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 30 days);
        subs.claim(id);
        // a 5% fee on 10 tokens
        assertEq(usdt.balanceOf(treasury), 0.5e18);
        assertEq(usdt.balanceOf(creator), 9.5e18);
    }

    function test_claimTwiceDoesNotDoublePay() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        uint256 creatorAfterFirst = usdt.balanceOf(creator);
        vm.expectRevert(FuguSubscription.NothingToClaim.selector);
        subs.claim(id);
        assertEq(usdt.balanceOf(creator), creatorAfterFirst);
    }

    function test_cancelRefundsUnearnedPortion() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        uint256 before = usdt.balanceOf(user);
        vm.prank(user);
        subs.cancel(id);
        // half was not earned by the agent, it must come back
        assertEq(usdt.balanceOf(user) - before, 5e18);
    }

    function test_earningsStopGrowingAfterCancel() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        vm.prank(user);
        subs.cancel(id);
        uint256 claimableAtCancel = subs.claimable(id);
        vm.warp(block.timestamp + 60 days);
        assertEq(subs.claimable(id), claimableAtCancel);
    }

    function test_agentStillClaimsEarnedAfterCancel() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        vm.prank(user);
        subs.cancel(id);
        subs.claim(id);
        assertEq(usdt.balanceOf(creator), 4.75e18); // 5 minus the 5% fee
    }

    function test_onlySubscriberCanCancel() public {
        uint256 id = _subscribeOnePeriod();
        vm.prank(creator);
        vm.expectRevert(FuguSubscription.NotSubscriber.selector);
        subs.cancel(id);
    }

    function test_cannotCancelTwice() public {
        uint256 id = _subscribeOnePeriod();
        vm.startPrank(user);
        subs.cancel(id);
        vm.expectRevert(FuguSubscription.AlreadyCancelled.selector);
        subs.cancel(id);
        vm.stopPrank();
    }

    function test_cannotSubscribeToInactiveListing() public {
        vm.prank(creator);
        registry.setActive(listingId, false);
        vm.prank(user);
        vm.expectRevert(FuguSubscription.ListingInactive.selector);
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);
    }

    function test_nativeSubscriptionRequiresExactValue() public {
        MockAggregator bnbFeed = new MockAggregator(8, 754_46000000);
        vm.prank(owner);
        oracle.setToken(
            address(0),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(bnbFeed),
                maxStaleness: 3600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        uint256 needed = oracle.quote(address(0), 10_00000000);
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.WrongNativeAmount.selector, needed, needed - 1));
        subs.subscribe{value: needed - 1}(listingId, 1, address(0), type(uint256).max, block.timestamp + 1 hours);

        vm.prank(user);
        uint256 id = subs.subscribe{value: needed}(listingId, 1, address(0), type(uint256).max, block.timestamp + 1 hours);
        assertEq(subs.getSub(id).deposited, needed);
    }

    function test_hasSubscribedGatesReputation() public {
        assertFalse(subs.hasSubscribed(listingId, user));
        uint256 id = _subscribeOnePeriod();
        // Subscribing alone has paid the agent nothing — no rating allowed yet.
        assertFalse(subs.hasSubscribed(listingId, user));
        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        // Only once the agent has actually been paid does the right to review open.
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    function test_multiplePeriodsScaleDeposit() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 3, address(usdt), type(uint256).max, block.timestamp + 1 hours);
        assertEq(subs.getSub(id).deposited, 30e18);
        assertEq(subs.getSub(id).endsAt - subs.getSub(id).startedAt, 90 days);
    }

    function test_zeroPeriodsReverts() public {
        vm.prank(user);
        vm.expectRevert(FuguSubscription.ZeroPeriods.selector);
        subs.subscribe(listingId, 0, address(usdt), type(uint256).max, block.timestamp + 1 hours);
    }

    /// @notice The contract never pays out more (or, in total, less) than what was
    ///         deposited — no funds can get stuck in the contract.
    function testFuzz_neverPaysOutMoreThanDeposited(uint32 periods, uint64 skipTime1, uint64 skipTime2) public {
        periods = uint32(bound(periods, 1, 12));
        skipTime1 = uint64(bound(skipTime1, 0, 400 days));
        skipTime2 = uint64(bound(skipTime2, 0, 400 days));

        vm.prank(user);
        uint256 id = subs.subscribe(listingId, periods, address(usdt), type(uint256).max, block.timestamp + 1 hours);
        uint256 deposited = subs.getSub(id).deposited;

        vm.warp(block.timestamp + skipTime1);

        uint256 creatorBefore = usdt.balanceOf(creator);
        uint256 treasuryBefore = usdt.balanceOf(treasury);
        uint256 userBefore = usdt.balanceOf(user);

        if (subs.claimable(id) > 0) subs.claim(id);

        // Warp again between claim and cancel, so the "already past endsAt naturally
        // before it could be cancelled" branch gets fuzzed too.
        vm.warp(block.timestamp + skipTime2);

        vm.prank(user);
        subs.cancel(id);
        if (subs.claimable(id) > 0) subs.claim(id);

        uint256 paidOut = (usdt.balanceOf(creator) - creatorBefore) + (usdt.balanceOf(treasury) - treasuryBefore)
            + (usdt.balanceOf(user) - userBefore);

        // The full invariant: not just "no more" — every cent deposited must come back out
        // (to the creator, the treasury, or the user), with nothing stuck.
        assertEq(paidOut, deposited);
        assertEq(usdt.balanceOf(address(subs)), 0);
    }

    function test_cancelInSameBlockRefundsEverything() public {
        uint256 id = _subscribeOnePeriod();
        uint256 before = usdt.balanceOf(user);

        vm.prank(user);
        subs.cancel(id);

        // No time elapsed at all -> the whole deposit comes back, the agent "earned"
        // nothing, and the reputation gate must not open on the price of gas alone.
        assertEq(usdt.balanceOf(user) - before, 10e18);
        assertEq(subs.claimable(id), 0);
        assertFalse(subs.hasSubscribed(listingId, user));
    }

    function test_nativePayoutDeferredWhenRecipientRejects() public {
        MockAggregator bnbFeed = new MockAggregator(8, 754_46000000);
        vm.prank(owner);
        oracle.setToken(
            address(0),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(bnbFeed),
                maxStaleness: 3600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );

        RejectingReceiver rejector = new RejectingReceiver();
        vm.prank(address(rejector));
        uint256 nativeListingId = registry.list(2, address(0xA6E17), Category.GRID, 10_00000000, 30 days, "");

        uint256 needed = oracle.quote(address(0), 10_00000000);
        vm.deal(user, needed);
        vm.prank(user);
        uint256 id = subs.subscribe{value: needed}(nativeListingId, 1, address(0), type(uint256).max, block.timestamp + 1 hours);

        vm.warp(block.timestamp + 30 days);

        // claim must not revert even when the recipient rejects ETH.
        subs.claim(id);
        assertEq(subs.pendingWithdrawals(address(rejector)), needed - (needed * 500) / 10_000);
        assertEq(address(rejector).balance, 0);

        rejector.setAccept(true);
        vm.prank(address(rejector));
        subs.withdrawPending();

        assertEq(address(rejector).balance, needed - (needed * 500) / 10_000);
        assertEq(subs.pendingWithdrawals(address(rejector)), 0);
    }

    function test_erc20SubscribeRejectsNonZeroValue() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.WrongNativeAmount.selector, 0, 1));
        subs.subscribe{value: 1}(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);
    }

    function test_onlyOwnerCanSetTreasuryAndFee() public {
        vm.expectRevert();
        subs.setTreasury(address(0xBEEF));

        vm.expectRevert();
        subs.setProtocolFeeBps(100);
    }

    function test_setProtocolFeeBpsRejectsTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(FuguSubscription.FeeTooHigh.selector);
        subs.setProtocolFeeBps(2001);
    }

    function test_feeSnapshotNotRetroactive() public {
        uint256 id = _subscribeOnePeriod();

        vm.prank(owner);
        subs.setProtocolFeeBps(2000); // raise to 20% after subscribing

        vm.warp(block.timestamp + 30 days);
        subs.claim(id);

        // Still computed with the 5% fee in force at subscribe time, not the current 20%.
        assertEq(usdt.balanceOf(treasury), 0.5e18);
        assertEq(usdt.balanceOf(creator), 9.5e18);
    }

    // ---------------------------------------------------------------------
    // Item 1 — the slippage guard on subscribe()
    // ---------------------------------------------------------------------

    /// @notice Reproduces the front-run attack: the user prepares a tx with a reasonable
    ///         `maxAmount`, the listing owner raises the price 100x first, and the user's tx
    ///         must revert instead of draining their whole allowance.
    function test_subscribeRevertsWhenPriceMovesAboveMax() public {
        // The user is willing to pay at most 10 USDT for one period ($10).
        uint256 maxAmount = 10e18;
        uint256 balanceBefore = usdt.balanceOf(user);

        // The listing owner front-runs: $10 -> $1000 per period.
        vm.prank(creator);
        registry.updateListing(listingId, 1000_00000000, 30 days, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, 1000e18, maxAmount));
        subs.subscribe(listingId, 1, address(usdt), maxAmount, block.timestamp + 1 hours);

        // Not a cent moves: the check happens before safeTransferFrom.
        assertEq(usdt.balanceOf(user), balanceBefore);
        assertEq(usdt.balanceOf(address(subs)), 0);
    }

    /// @notice The same guard applies when it is the oracle price that moves, not the
    ///         listing price.
    function test_subscribeRevertsWhenOraclePriceMovesAboveMax() public {
        // maxAmount was computed at a $1 peg = 10 tokens.
        uint256 maxAmount = 10e18;
        // Depeg: 1 USDT is suddenly priced at $0.10, so $10 now needs 100 tokens.
        usdtFeed.setPrice(10_000_000); // $0.10 in USD8

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, 100e18, maxAmount));
        subs.subscribe(listingId, 1, address(usdt), maxAmount, block.timestamp + 1 hours);
    }

    /// @notice The native path uses the same guard, and no ETH is left behind.
    function test_nativeSubscribeRevertsWhenAmountExceedsMax() public {
        _enableNative();
        uint256 needed = oracle.quote(address(0), 10_00000000);

        vm.deal(user, needed);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, needed, needed - 1));
        subs.subscribe{value: needed}(listingId, 1, address(0), needed - 1, block.timestamp + 1 hours);

        assertEq(user.balance, needed);
    }

    /// @notice A bound exactly equal to the price must pass — this guard is `>`, not `>=`.
    function test_subscribeAcceptsAmountExactlyAtMax() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 1, address(usdt), 10e18, block.timestamp + 1 hours);
        assertEq(subs.getSub(id).deposited, 10e18);
    }

    function test_subscribeRevertsAfterDeadline() public {
        uint256 deadline = block.timestamp - 1;
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.DeadlinePassed.selector, deadline));
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, deadline);
    }

    /// @notice `deadline == block.timestamp` is still valid (the guard is `>`, not `>=`).
    function test_subscribeAcceptsDeadlineAtCurrentBlock() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp);
        assertEq(subs.getSub(id).deposited, 10e18);
    }

    /// @notice The deadline is checked before anything that touches funds.
    function test_deadlineCheckedBeforeAnyTransfer() public {
        uint256 balanceBefore = usdt.balanceOf(user);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(user);
        vm.expectRevert();
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp - 1 hours);
        assertEq(usdt.balanceOf(user), balanceBefore);
    }

    // ---------------------------------------------------------------------
    // Item 2 — the anti-sybil threshold on review eligibility
    // ---------------------------------------------------------------------

    function test_defaultMinPaidBpsIsHalfPeriod() public view {
        assertEq(subs.minPaidBpsOfPeriod(), 5000);
    }

    /// @notice Reproduces the sybil PoC: subscribe, advance 1 second, claim, cancel.
    ///         Total paid is about 0.0000039 USDT — far below the 50% threshold, so the
    ///         right to review MUST NOT open.
    function test_reviewGateRejectsDustPayment() public {
        uint256 id = _subscribeOnePeriod();

        vm.warp(block.timestamp + 1);
        subs.claim(id);
        vm.prank(user);
        subs.cancel(id);

        // A payment did happen — but the amount is dust.
        uint256 paid = subs.paidToAgent(listingId, user);
        assertGt(paid, 0);
        assertLt(paid, 1e13); // < 0.00001 USDT
        assertFalse(subs.hasSubscribed(listingId, user));
    }

    /// @notice Paying past half the period opens the right to review.
    function test_reviewGateAcceptsRealPayment() public {
        uint256 id = _subscribeOnePeriod();

        vm.warp(block.timestamp + 15 days + 1);
        subs.claim(id);

        assertGe(subs.paidToAgent(listingId, user), 5e18);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice Exactly 50% passes the threshold (the comparison is `>=`).
    function test_reviewGateAcceptsExactlyHalfPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        assertEq(subs.paidToAgent(listingId, user), 5e18);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice A little under half the period is not enough.
    function test_reviewGateRejectsJustUnderHalfPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days - 1);
        subs.claim(id);
        assertFalse(subs.hasSubscribed(listingId, user));
    }

    /// @notice Subscribing for 3 periods: the denominator is still the price of ONE
    ///         period, so half of the first period is already enough.
    function test_reviewGateUsesOnePeriodAsDenominator() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 3, address(usdt), type(uint256).max, block.timestamp + 1 hours);
        assertEq(subs.periodPriceRef(listingId, user), 10e18);

        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice `_periodPriceRef` is locked on the first subscription: the listing owner
    ///         cannot raise the price later to revoke a review right that is nearly earned.
    function test_periodPriceRefLockedOnFirstSubscribe() public {
        _subscribeOnePeriod();
        assertEq(subs.periodPriceRef(listingId, user), 10e18);

        vm.prank(creator);
        registry.updateListing(listingId, 100_00000000, 30 days, "");

        vm.prank(user);
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        // Still 10e18, not 100e18.
        assertEq(subs.periodPriceRef(listingId, user), 10e18);
    }

    function test_hasSubscribedFalseWithoutAnySubscription() public view {
        assertFalse(subs.hasSubscribed(listingId, address(0xDEAD)));
    }

    function test_setMinPaidBpsOfPeriodChangesGate() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 1 days);
        subs.claim(id);
        // 1/30 of a period < 50% -> still closed
        assertFalse(subs.hasSubscribed(listingId, user));

        // Drop the threshold to 3% of one period -> it opens.
        vm.prank(owner);
        subs.setMinPaidBpsOfPeriod(300);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    function test_onlyOwnerCanSetMinPaidBps() public {
        vm.expectRevert();
        subs.setMinPaidBpsOfPeriod(1);
    }

    // ---------------------------------------------------------------------
    // Item 6 — zero address validation
    // ---------------------------------------------------------------------

    function test_rejectsZeroAddresses() public {
        FuguSubscription impl = new FuguSubscription();

        vm.expectRevert(FuguSubscription.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(FuguSubscription.initialize, (owner, address(0), address(oracle), treasury, 500))
        );

        vm.expectRevert(FuguSubscription.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(FuguSubscription.initialize, (owner, address(registry), address(0), treasury, 500))
        );

        vm.expectRevert(FuguSubscription.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(FuguSubscription.initialize, (owner, address(registry), address(oracle), address(0), 500))
        );

        vm.prank(owner);
        vm.expectRevert(FuguSubscription.ZeroAddress.selector);
        subs.setTreasury(address(0));
    }

    // ---------------------------------------------------------------------
    // Item 7 — a zero amount is rejected symmetrically on both payment paths
    // ---------------------------------------------------------------------

    /// @notice A price that rounds down to zero must revert with the SAME error on both
    ///         the native and the ERC-20 path — previously the native path silently
    ///         accepted an empty subscription worth 0.
    function test_zeroQuoteRevertsOnBothPaymentPaths() public {
        // A 6-decimal token priced at $1,000,000 per unit: $0.00000001 rounds down to 0 units.
        MockERC20Decimals pricey = new MockERC20Decimals("Pricey", "PRC", 6);
        MockAggregator priceyFeed = new MockAggregator(8, 1_000_000_00000000);
        vm.startPrank(owner);
        oracle.setToken(
            address(pricey),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(priceyFeed),
                maxStaleness: 90000,
                tokenDecimals: 6,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        // The native coin is priced extremely high too.
        MockAggregator nativeFeed = new MockAggregator(8, 1_000_000_00000000);
        oracle.setToken(
            address(0),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(nativeFeed),
                maxStaleness: 3600,
                tokenDecimals: 6,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        vm.stopPrank();

        // A $0.000001 per period listing -> the quote rounds down to 0 for both tokens.
        vm.prank(creator);
        uint256 cheapId = registry.list(777, address(0xA6E17), Category.GRID, 1, 30 days, "");

        assertEq(oracle.quote(address(0), 1), 0);

        vm.prank(user);
        vm.expectRevert(FuguSubscription.ZeroAmountReceived.selector);
        subs.subscribe(cheapId, 1, address(pricey), type(uint256).max, block.timestamp + 1 hours);

        vm.prank(user);
        vm.expectRevert(FuguSubscription.ZeroAmountReceived.selector);
        subs.subscribe{value: 0}(cheapId, 1, address(0), type(uint256).max, block.timestamp + 1 hours);
    }

    function _enableNative() internal {
        MockAggregator bnbFeed = new MockAggregator(8, 754_46000000);
        vm.prank(owner);
        oracle.setToken(
            address(0),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(bnbFeed),
                maxStaleness: 3600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
    }
}

/// @notice A minimal contract to test the pending-withdrawal path: it rejects ETH until
///         `accept` is turned on.
contract RejectingReceiver {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        require(accept, "rejected");
    }
}
