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

        // listing: $10 per 30 hari
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
        // $10 pada peg $1 = 10 token
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
        // fee 5% dari 10 token
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
        // separuh belum diperoleh agent, harus kembali
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
        assertEq(usdt.balanceOf(creator), 4.75e18); // 5 dikurangi fee 5%
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
        // Subscribe saja belum membayar apa pun ke agent — belum boleh menilai.
        assertFalse(subs.hasSubscribed(listingId, user));
        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        // Baru setelah agent benar-benar dibayar, hak review terbuka.
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

    /// @notice Kontrak tidak pernah membayar lebih (atau kurang, secara total) dari yang
    ///         disetor — tidak ada dana yang bisa nyangkut di kontrak.
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

        // Warp lagi di antara claim dan cancel, supaya cabang "sudah lewat endsAt secara
        // alami sebelum sempat di-cancel" ikut ter-fuzz.
        vm.warp(block.timestamp + skipTime2);

        vm.prank(user);
        subs.cancel(id);
        if (subs.claimable(id) > 0) subs.claim(id);

        uint256 paidOut = (usdt.balanceOf(creator) - creatorBefore) + (usdt.balanceOf(treasury) - treasuryBefore)
            + (usdt.balanceOf(user) - userBefore);

        // Invarian penuh: bukan cuma "tidak lebih" — setiap rupiah yang disetor harus
        // keluar lagi (ke creator, treasury, atau user), tidak ada yang nyangkut.
        assertEq(paidOut, deposited);
        assertEq(usdt.balanceOf(address(subs)), 0);
    }

    function test_cancelInSameBlockRefundsEverything() public {
        uint256 id = _subscribeOnePeriod();
        uint256 before = usdt.balanceOf(user);

        vm.prank(user);
        subs.cancel(id);

        // Tidak ada waktu berlalu sama sekali -> seluruh deposit kembali, tidak ada yang
        // "diperoleh" agent, dan gate reputasi tidak boleh terbuka hanya bermodal gas.
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

        // claim tidak boleh revert walau penerima menolak ETH.
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
        subs.setProtocolFeeBps(2000); // naikkan ke 20% setelah subscribe

        vm.warp(block.timestamp + 30 days);
        subs.claim(id);

        // Tetap dihitung dengan fee 5% yang berlaku saat subscribe, bukan 20% saat ini.
        assertEq(usdt.balanceOf(treasury), 0.5e18);
        assertEq(usdt.balanceOf(creator), 9.5e18);
    }

    // ---------------------------------------------------------------------
    // Butir 1 — slippage guard pada subscribe()
    // ---------------------------------------------------------------------

    /// @notice Reproduksi serangan front-run: user menyiapkan tx dengan `maxAmount`
    ///         wajar, pemilik listing menaikkan harga 100x lebih dulu, dan tx user
    ///         harus revert alih-alih menguras seluruh allowance-nya.
    function test_subscribeRevertsWhenPriceMovesAboveMax() public {
        // User bersedia membayar paling banyak 10 USDT untuk satu periode ($10).
        uint256 maxAmount = 10e18;
        uint256 balanceBefore = usdt.balanceOf(user);

        // Pemilik listing mem-front-run: $10 -> $1000 per periode.
        vm.prank(creator);
        registry.updateListing(listingId, 1000_00000000, 30 days, "");

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, 1000e18, maxAmount));
        subs.subscribe(listingId, 1, address(usdt), maxAmount, block.timestamp + 1 hours);

        // Tidak sepeser pun berpindah: pemeriksaan terjadi sebelum safeTransferFrom.
        assertEq(usdt.balanceOf(user), balanceBefore);
        assertEq(usdt.balanceOf(address(subs)), 0);
    }

    /// @notice Guard yang sama berlaku ketika yang bergerak adalah harga oracle,
    ///         bukan harga listing.
    function test_subscribeRevertsWhenOraclePriceMovesAboveMax() public {
        // maxAmount dihitung pada peg $1 = 10 token.
        uint256 maxAmount = 10e18;
        // Depeg: 1 USDT tiba-tiba dihargai $0,10, jadi butuh 100 token untuk $10.
        usdtFeed.setPrice(10_000_000); // $0,10 dalam USD8

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, 100e18, maxAmount));
        subs.subscribe(listingId, 1, address(usdt), maxAmount, block.timestamp + 1 hours);
    }

    /// @notice Jalur native memakai guard yang sama, dan tidak ada ETH yang tertinggal.
    function test_nativeSubscribeRevertsWhenAmountExceedsMax() public {
        _enableNative();
        uint256 needed = oracle.quote(address(0), 10_00000000);

        vm.deal(user, needed);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(FuguSubscription.AmountExceedsMax.selector, needed, needed - 1));
        subs.subscribe{value: needed}(listingId, 1, address(0), needed - 1, block.timestamp + 1 hours);

        assertEq(user.balance, needed);
    }

    /// @notice Batas persis sama dengan harga harus lolos — guard ini `>`, bukan `>=`.
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

    /// @notice `deadline == block.timestamp` masih sah (guard-nya `>`, bukan `>=`).
    function test_subscribeAcceptsDeadlineAtCurrentBlock() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp);
        assertEq(subs.getSub(id).deposited, 10e18);
    }

    /// @notice Deadline diperiksa sebelum apa pun yang menyentuh dana.
    function test_deadlineCheckedBeforeAnyTransfer() public {
        uint256 balanceBefore = usdt.balanceOf(user);
        vm.warp(block.timestamp + 2 hours);
        vm.prank(user);
        vm.expectRevert();
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp - 1 hours);
        assertEq(usdt.balanceOf(user), balanceBefore);
    }

    // ---------------------------------------------------------------------
    // Butir 2 — ambang anti-sybil pada hak review
    // ---------------------------------------------------------------------

    function test_defaultMinPaidBpsIsHalfPeriod() public view {
        assertEq(subs.minPaidBpsOfPeriod(), 5000);
    }

    /// @notice Reproduksi PoC sybil: subscribe, maju 1 detik, claim, cancel.
    ///         Total yang dibayar ~0,0000039 USDT — jauh di bawah ambang 50%,
    ///         jadi hak review TIDAK boleh terbuka.
    function test_reviewGateRejectsDustPayment() public {
        uint256 id = _subscribeOnePeriod();

        vm.warp(block.timestamp + 1);
        subs.claim(id);
        vm.prank(user);
        subs.cancel(id);

        // Pembayaran memang terjadi — tapi jumlahnya debu.
        uint256 paid = subs.paidToAgent(listingId, user);
        assertGt(paid, 0);
        assertLt(paid, 1e13); // < 0,00001 USDT
        assertFalse(subs.hasSubscribed(listingId, user));
    }

    /// @notice Membayar melewati separuh periode membuka hak review.
    function test_reviewGateAcceptsRealPayment() public {
        uint256 id = _subscribeOnePeriod();

        vm.warp(block.timestamp + 15 days + 1);
        subs.claim(id);

        assertGe(subs.paidToAgent(listingId, user), 5e18);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice Tepat 50% adalah ambang yang lolos (perbandingannya `>=`).
    function test_reviewGateAcceptsExactlyHalfPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        assertEq(subs.paidToAgent(listingId, user), 5e18);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice Sedikit di bawah separuh periode belum cukup.
    function test_reviewGateRejectsJustUnderHalfPeriod() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 15 days - 1);
        subs.claim(id);
        assertFalse(subs.hasSubscribed(listingId, user));
    }

    /// @notice Berlangganan 3 periode: penyebutnya tetap harga SATU periode, jadi
    ///         separuh periode pertama sudah cukup.
    function test_reviewGateUsesOnePeriodAsDenominator() public {
        vm.prank(user);
        uint256 id = subs.subscribe(listingId, 3, address(usdt), type(uint256).max, block.timestamp + 1 hours);
        assertEq(subs.periodPriceRef(listingId, user), 10e18);

        vm.warp(block.timestamp + 15 days);
        subs.claim(id);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    /// @notice `_periodPriceRef` dikunci pada langganan pertama: pemilik listing tidak
    ///         bisa menaikkan harga belakangan untuk mencabut hak review yang hampir
    ///         diperoleh.
    function test_periodPriceRefLockedOnFirstSubscribe() public {
        _subscribeOnePeriod();
        assertEq(subs.periodPriceRef(listingId, user), 10e18);

        vm.prank(creator);
        registry.updateListing(listingId, 100_00000000, 30 days, "");

        vm.prank(user);
        subs.subscribe(listingId, 1, address(usdt), type(uint256).max, block.timestamp + 1 hours);

        // Tetap 10e18, bukan 100e18.
        assertEq(subs.periodPriceRef(listingId, user), 10e18);
    }

    function test_hasSubscribedFalseWithoutAnySubscription() public view {
        assertFalse(subs.hasSubscribed(listingId, address(0xDEAD)));
    }

    function test_setMinPaidBpsOfPeriodChangesGate() public {
        uint256 id = _subscribeOnePeriod();
        vm.warp(block.timestamp + 1 days);
        subs.claim(id);
        // 1/30 periode < 50% -> masih tertutup
        assertFalse(subs.hasSubscribed(listingId, user));

        // Turunkan ambang ke 3% dari satu periode -> terbuka.
        vm.prank(owner);
        subs.setMinPaidBpsOfPeriod(300);
        assertTrue(subs.hasSubscribed(listingId, user));
    }

    function test_onlyOwnerCanSetMinPaidBps() public {
        vm.expectRevert();
        subs.setMinPaidBpsOfPeriod(1);
    }

    // ---------------------------------------------------------------------
    // Butir 6 — validasi alamat nol
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
    // Butir 7 — jumlah nol ditolak simetris di kedua jalur pembayaran
    // ---------------------------------------------------------------------

    /// @notice Harga yang membulat ke nol harus revert dengan error yang SAMA pada
    ///         jalur native maupun ERC-20 — sebelumnya jalur native diam-diam
    ///         menerima langganan kosong senilai 0.
    function test_zeroQuoteRevertsOnBothPaymentPaths() public {
        // Token 6 desimal berharga $1.000.000 per unit: $0,00000001 membulat ke 0 unit.
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
        // Native juga dihargai sangat tinggi.
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

        // Listing $0,000001 per periode -> quote membulat ke 0 pada kedua token.
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

/// @notice Kontrak minimal untuk menguji jalur pending-withdrawal: menolak ETH sampai
///         `accept` diaktifkan.
contract RejectingReceiver {
    bool public accept;

    function setAccept(bool value) external {
        accept = value;
    }

    receive() external payable {
        require(accept, "rejected");
    }
}
