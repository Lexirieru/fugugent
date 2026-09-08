// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {MockToken} from "../src/mocks/MockToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract MocksTest is Test {
    address internal owner = address(this);
    address internal stranger = address(0xBEEF);

    MockPriceFeed internal feed;
    MockToken internal token;

    function setUp() public {
        feed = new MockPriceFeed(8, 100_000_000); // $1.00 at 8 decimals
        token = new MockToken("Mock USD", "mUSD");
    }

    // ---------------------------------------------------------------
    // MockPriceFeed
    // ---------------------------------------------------------------

    function test_feedReturnsInitialAnswer() public view {
        (, int256 answer,,,) = feed.latestRoundData();
        assertEq(answer, 100_000_000);
        assertEq(feed.decimals(), 8);
        assertEq(feed.description(), "mock");
    }

    function test_setAnswerUpdatesAnswerAndUpdatedAt() public {
        (,,, uint256 updatedAtBefore,) = feed.latestRoundData();

        vm.warp(block.timestamp + 1 days);
        feed.setAnswer(200_000_000);

        (, int256 answer,, uint256 updatedAtAfter,) = feed.latestRoundData();
        assertEq(answer, 200_000_000);
        assertGt(updatedAtAfter, updatedAtBefore);
        assertEq(updatedAtAfter, block.timestamp);
    }

    function test_setAnswerRevertsForNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        feed.setAnswer(1);
    }

    // ---------------------------------------------------------------
    // MockToken
    // ---------------------------------------------------------------

    function test_tokenHas18Decimals() public view {
        assertEq(token.decimals(), 18);
    }

    function test_mintIncreasesBalance() public {
        assertEq(token.balanceOf(stranger), 0);
        token.mint(stranger, 1_000 ether);
        assertEq(token.balanceOf(stranger), 1_000 ether);
    }

    function test_mintIsPermissionless() public {
        vm.prank(stranger);
        token.mint(stranger, 5 ether);
        assertEq(token.balanceOf(stranger), 5 ether);
    }
}
