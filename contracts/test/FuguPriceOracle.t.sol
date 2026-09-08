// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";

contract FuguPriceOracleTest is Test {
    FuguPriceOracle oracle;
    MockAggregator bnbFeed;
    address owner = address(0xA11CE);
    address token = address(0xBEEF);

    function setUp() public {
        vm.warp(1_700_000_000);
        FuguPriceOracle impl = new FuguPriceOracle();
        bytes memory data = abi.encodeCall(FuguPriceOracle.initialize, (owner));
        oracle = FuguPriceOracle(address(new ERC1967Proxy(address(impl), data)));

        // BNB/USD = $754.46, 8 desimal — meniru feed testnet asli
        bnbFeed = new MockAggregator(8, 754_46000000);

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

    function test_quoteNativeAtKnownPrice() public view {
        // $754.46 dalam USD8
        uint256 oneBnbInUsd8 = 754_46000000;
        // membeli senilai 1 BNB harus menghasilkan tepat 1e18
        assertEq(oracle.quote(address(0), oneBnbInUsd8), 1e18);
    }

    function test_quoteHalfUnit() public view {
        assertEq(oracle.quote(address(0), 377_23000000), 0.5e18);
    }

    function test_revertsOnDisabledToken() public {
        vm.expectRevert(abi.encodeWithSelector(FuguPriceOracle.TokenNotEnabled.selector, token));
        oracle.quote(token, 1e8);
    }

    function test_revertsOnStalePrice() public {
        bnbFeed.setUpdatedAt(block.timestamp - 3601);
        vm.expectRevert();
        oracle.quote(address(0), 1e8);
    }

    function test_acceptsPriceAtStalenessBoundary() public {
        bnbFeed.setUpdatedAt(block.timestamp - 3600);
        assertGt(oracle.quote(address(0), 1e8), 0);
    }

    function test_revertsOnNonPositivePrice() public {
        bnbFeed.setPrice(0);
        vm.expectRevert(abi.encodeWithSelector(FuguPriceOracle.InvalidPrice.selector, int256(0)));
        oracle.quote(address(0), 1e8);
    }

    function test_fixedPriceTokenIgnoresStaleness() public {
        address u = address(0x11FF);
        vm.prank(owner);
        oracle.setToken(
            u,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.FIXED_USD,
                feed: address(0),
                maxStaleness: 0,
                tokenDecimals: 18,
                fixedPriceUsd8: 1_00000000,
                enabled: true
            })
        );
        // $5 pada peg $1 = 5 token
        assertEq(oracle.quote(u, 5_00000000), 5e18);
    }

    function test_normalizesFeedWithNon8Decimals() public {
        address t = address(0xCAFE);
        MockAggregator feed18 = new MockAggregator(18, 2e18); // $2, 18 desimal
        vm.prank(owner);
        oracle.setToken(
            t,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: address(feed18),
                maxStaleness: 3600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        assertEq(oracle.quote(t, 2_00000000), 1e18);
    }

    function test_onlyOwnerCanSetToken() public {
        vm.expectRevert();
        oracle.setToken(
            token,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.FIXED_USD,
                feed: address(0),
                maxStaleness: 0,
                tokenDecimals: 18,
                fixedPriceUsd8: 1_00000000,
                enabled: true
            })
        );
    }

    function test_cannotInitializeTwice() public {
        vm.expectRevert();
        oracle.initialize(owner);
    }
}
