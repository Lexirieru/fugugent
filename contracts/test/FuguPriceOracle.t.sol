// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {MockAggregator} from "./mocks/MockAggregator.sol";
import {MockERC20Decimals, MockERC20NoDecimals} from "./mocks/MockERC20Decimals.sol";

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

        // BNB/USD = $754.46, 8 decimals — imitates the real testnet feed
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
        // $754.46 in USD8
        uint256 oneBnbInUsd8 = 754_46000000;
        // buying 1 BNB worth must yield exactly 1e18
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
        // $5 at a $1 peg = 5 tokens
        assertEq(oracle.quote(u, 5_00000000), 5e18);
    }

    function test_normalizesFeedWithNon8Decimals() public {
        address t = address(0xCAFE);
        MockAggregator feed18 = new MockAggregator(18, 2e18); // $2, 18 decimals
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

    function test_revertsOnFutureTimestamp() public {
        bnbFeed.setUpdatedAt(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(FuguPriceOracle.FuturePrice.selector, address(0), block.timestamp + 1));
        oracle.quote(address(0), 1e8);
    }

    function test_implementationCannotBeInitialized() public {
        FuguPriceOracle impl = new FuguPriceOracle();
        vm.expectRevert();
        impl.initialize(owner);
    }

    // ---------------------------------------------------------------------
    // Item 5 — `tokenDecimals` is verified against on-chain `decimals()`
    // ---------------------------------------------------------------------

    function _chainlinkCfg(uint8 tokenDecimals) internal view returns (FuguPriceOracle.TokenConfig memory) {
        return FuguPriceOracle.TokenConfig({
            kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
            feed: address(bnbFeed),
            maxStaleness: 3600,
            tokenDecimals: tokenDecimals,
            fixedPriceUsd8: 0,
            enabled: true
        });
    }

    /// @notice One wrong digit in `tokenDecimals` shifts the whole price by 10x, so the
    ///         value declared by the owner must match the real token.
    function test_setTokenRejectsDecimalsMismatch() public {
        MockERC20Decimals sixDec = new MockERC20Decimals("Six", "SIX", 6);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(FuguPriceOracle.DecimalsMismatch.selector, uint8(18), uint8(6)));
        oracle.setToken(address(sixDec), _chainlinkCfg(18));

        // the old config was not written
        assertEq(uint8(oracle.tokenConfig(address(sixDec)).kind), uint8(FuguPriceOracle.PriceSourceKind.NONE));
    }

    function test_setTokenAcceptsMatchingDecimals() public {
        MockERC20Decimals sixDec = new MockERC20Decimals("Six", "SIX", 6);
        vm.prank(owner);
        oracle.setToken(address(sixDec), _chainlinkCfg(6));
        assertEq(oracle.tokenConfig(address(sixDec)).tokenDecimals, 6);
        // $754.46 with a 6-decimal token = 1e6 units
        assertEq(oracle.quote(address(sixDec), 754_46000000), 1e6);
    }

    /// @notice A token whose `decimals()` reverts is still accepted, but it must leave a
    ///         `DecimalsUnverified` trace.
    function test_setTokenEmitsDecimalsUnverifiedWhenCallFails() public {
        MockERC20NoDecimals odd = new MockERC20NoDecimals("Odd", "ODD");
        vm.expectEmit(true, false, false, false, address(oracle));
        emit FuguPriceOracle.DecimalsUnverified(address(odd));
        vm.prank(owner);
        oracle.setToken(address(odd), _chainlinkCfg(18));
        assertEq(oracle.tokenConfig(address(odd)).tokenDecimals, 18);
    }

    /// @notice An address with no code (e.g. a token not deployed yet) cannot be verified
    ///         either — accepted, but flagged.
    function test_setTokenEmitsDecimalsUnverifiedForNonContract() public {
        vm.expectEmit(true, false, false, false, address(oracle));
        emit FuguPriceOracle.DecimalsUnverified(token);
        vm.prank(owner);
        oracle.setToken(token, _chainlinkCfg(18));
    }

    /// @notice The native coin (address(0)) has no `decimals()` — this verification must
    ///         not block configuring tBNB.
    function test_setTokenSkipsDecimalsCheckForNative() public {
        vm.prank(owner);
        oracle.setToken(address(0), _chainlinkCfg(18));
        assertEq(oracle.tokenConfig(address(0)).tokenDecimals, 18);
    }

    // ---------------------------------------------------------------------
    // Item 8 — disabling a token
    // ---------------------------------------------------------------------

    function test_disableToken() public {
        // Initially native is enabled and can be quoted.
        assertGt(oracle.quote(address(0), 1e8), 0);

        vm.expectEmit(true, false, false, false, address(oracle));
        emit FuguPriceOracle.TokenDisabled(address(0));
        vm.prank(owner);
        oracle.disableToken(address(0));

        assertFalse(oracle.tokenConfig(address(0)).enabled);
        vm.expectRevert(abi.encodeWithSelector(FuguPriceOracle.TokenNotEnabled.selector, address(0)));
        oracle.quote(address(0), 1e8);

        // The rest of the config stays intact, so it can be re-enabled via setToken.
        assertEq(oracle.tokenConfig(address(0)).feed, address(bnbFeed));
    }

    /// @notice This emergency path must keep working even when the old config would no
    ///         longer pass `setToken` validation.
    function test_disableTokenWorksOnUnconfiguredToken() public {
        vm.prank(owner);
        oracle.disableToken(address(0xDEAD));
        assertFalse(oracle.tokenConfig(address(0xDEAD)).enabled);
    }

    function test_onlyOwnerCanDisableToken() public {
        vm.expectRevert();
        oracle.disableToken(address(0));
        assertTrue(oracle.tokenConfig(address(0)).enabled);
    }
}
