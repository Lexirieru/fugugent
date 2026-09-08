// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {FuguReputation} from "../src/FuguReputation.sol";

contract Deploy is Script {
    // BSC testnet addresses — verified live 2026-09-08
    address constant FEED_BNB_USD = 0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526;
    address constant FEED_USDT_USD = 0xEca2605f0BCF2BA5966372C99837b1F182d3D620;
    address constant FEED_BUSD_USD = 0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa;
    address constant TOKEN_USDT = 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd;
    address constant TOKEN_BUSD = 0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee;
    address constant TOKEN_U = 0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        uint16 feeBps = uint16(vm.envUint("PROTOCOL_FEE_BPS"));

        vm.startBroadcast(pk);

        FuguPriceOracle oracle = FuguPriceOracle(
            address(new ERC1967Proxy(
                address(new FuguPriceOracle()), abi.encodeCall(FuguPriceOracle.initialize, (deployer))
            ))
        );

        FuguRegistry registry = FuguRegistry(
            address(new ERC1967Proxy(
                address(new FuguRegistry()), abi.encodeCall(FuguRegistry.initialize, (deployer))
            ))
        );

        FuguSubscription subs = FuguSubscription(
            payable(address(new ERC1967Proxy(
                address(new FuguSubscription()),
                abi.encodeCall(
                    FuguSubscription.initialize,
                    (deployer, address(registry), address(oracle), treasury, feeBps)
                )
            )))
        );

        FuguReputation rep = FuguReputation(
            address(new ERC1967Proxy(
                address(new FuguReputation()),
                abi.encodeCall(FuguReputation.initialize, (deployer, address(subs)))
            ))
        );

        // Configure the payment tokens
        oracle.setToken(
            address(0),
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: FEED_BNB_USD,
                maxStaleness: 3600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        oracle.setToken(
            TOKEN_USDT,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: FEED_USDT_USD,
                maxStaleness: 93_600, // 26 hours — the testnet stablecoin heartbeat is slow
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        oracle.setToken(
            TOKEN_BUSD,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.CHAINLINK,
                feed: FEED_BUSD_USD,
                maxStaleness: 93_600,
                tokenDecimals: 18,
                fixedPriceUsd8: 0,
                enabled: true
            })
        );
        oracle.setToken(
            TOKEN_U,
            FuguPriceOracle.TokenConfig({
                kind: FuguPriceOracle.PriceSourceKind.FIXED_USD,
                feed: address(0),
                maxStaleness: 0,
                tokenDecimals: 18,
                fixedPriceUsd8: 1_00000000,
                enabled: true
            })
        );

        registry.setCurator(deployer, true);

        vm.stopBroadcast();

        console.log("FuguPriceOracle  ", address(oracle));
        console.log("FuguRegistry     ", address(registry));
        console.log("FuguSubscription ", address(subs));
        console.log("FuguReputation   ", address(rep));
    }
}
