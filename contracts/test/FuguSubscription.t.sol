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
        return subs.subscribe(listingId, 1, address(usdt));
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
        subs.subscribe(listingId, 1, address(usdt));
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
        subs.subscribe{value: needed - 1}(listingId, 1, address(0));

        vm.prank(user);
        uint256 id = subs.subscribe{value: needed}(listingId, 1, address(0));
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
        uint256 id = subs.subscribe(listingId, 3, address(usdt));
        assertEq(subs.getSub(id).deposited, 30e18);
        assertEq(subs.getSub(id).endsAt - subs.getSub(id).startedAt, 90 days);
    }

    function test_zeroPeriodsReverts() public {
        vm.prank(user);
        vm.expectRevert(FuguSubscription.ZeroPeriods.selector);
        subs.subscribe(listingId, 0, address(usdt));
    }

    /// @notice Kontrak tidak pernah membayar lebih (atau kurang, secara total) dari yang
    ///         disetor — tidak ada dana yang bisa nyangkut di kontrak.
    function testFuzz_neverPaysOutMoreThanDeposited(uint32 periods, uint64 skipTime1, uint64 skipTime2) public {
        periods = uint32(bound(periods, 1, 12));
        skipTime1 = uint64(bound(skipTime1, 0, 400 days));
        skipTime2 = uint64(bound(skipTime2, 0, 400 days));

        vm.prank(user);
        uint256 id = subs.subscribe(listingId, periods, address(usdt));
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
        uint256 id = subs.subscribe{value: needed}(nativeListingId, 1, address(0));

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
        subs.subscribe{value: 1}(listingId, 1, address(usdt));
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
