// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguReputation} from "../src/FuguReputation.sol";
import {IFuguSubscription} from "../src/interfaces/IFuguSubscription.sol";

contract StubSubscription is IFuguSubscription {
    mapping(uint256 => mapping(address => bool)) public subscribed;

    function setSubscribed(uint256 listingId, address user, bool v) external {
        subscribed[listingId][user] = v;
    }

    function hasSubscribed(uint256 listingId, address user) external view returns (bool) {
        return subscribed[listingId][user];
    }
}

contract FuguReputationTest is Test {
    FuguReputation rep;
    StubSubscription stub;
    address owner = address(0xA11CE);
    address alice = address(0xA);
    address bob = address(0xB);

    function setUp() public {
        stub = new StubSubscription();
        FuguReputation impl = new FuguReputation();
        rep = FuguReputation(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguReputation.initialize, (owner, address(stub)))))
        );
        stub.setSubscribed(1, alice, true);
        stub.setSubscribed(1, bob, true);
    }

    function test_nonSubscriberCannotReview() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert(FuguReputation.NotASubscriber.selector);
        rep.review(1, 5, "ipfs://r");
    }

    function test_subscriberCanReview() public {
        vm.prank(alice);
        rep.review(1, 4, "ipfs://r");
        assertEq(rep.reviewCount(1), 1);
        assertEq(rep.averageScoreX100(1), 400);
    }

    function test_averageAcrossTwoReviews() public {
        vm.prank(alice);
        rep.review(1, 5, "");
        vm.prank(bob);
        rep.review(1, 4, "");
        assertEq(rep.reviewCount(1), 2);
        assertEq(rep.averageScoreX100(1), 450);
    }

    function test_cannotReviewTwice() public {
        vm.startPrank(alice);
        rep.review(1, 5, "");
        vm.expectRevert(FuguReputation.AlreadyReviewed.selector);
        rep.review(1, 3, "");
        vm.stopPrank();
    }

    function test_rejectsScoreOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FuguReputation.InvalidScore.selector, uint8(6)));
        rep.review(1, 6, "");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FuguReputation.InvalidScore.selector, uint8(0)));
        rep.review(1, 0, "");
    }

    function test_averageOfEmptyListingIsZero() public view {
        assertEq(rep.averageScoreX100(99), 0);
    }

    function test_acceptsBoundaryScores() public {
        stub.setSubscribed(2, alice, true);
        stub.setSubscribed(3, bob, true);

        vm.prank(alice);
        rep.review(2, 1, "");

        vm.prank(bob);
        rep.review(3, 5, "");

        assertEq(rep.reviewCount(2), 1);
        assertEq(rep.averageScoreX100(2), 100);
        assertEq(rep.reviewCount(3), 1);
        assertEq(rep.averageScoreX100(3), 500);
    }

    function test_onlyOwnerCanSetSubscriptions() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        rep.setSubscriptions(address(0x1234));
    }
}
