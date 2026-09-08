// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ListAgents} from "../script/ListAgents.s.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @dev Membuka bagian internal `ListAgents` supaya jalur pendaftaran yang PERSIS
///      sama bisa dijalankan terhadap registry lokal — tanpa env var dan tanpa
///      broadcast. Argumen `list()` yang tertukar (mis. `agentWallet` dengan
///      `category`) harus tertangkap di sini, bukan setelah tBNB terbakar.
contract ListAgentsHarness is ListAgents {
    function listAll(FuguRegistry registry) external {
        _listAll(registry);
    }

    function verifyAll(FuguRegistry registry) external view {
        _verifyAll(registry);
    }

    function plan() external pure returns (AgentPlan[3] memory) {
        return _plan();
    }

    function metadata(uint256 i) external pure returns (string memory) {
        return _metadata(_plan()[i]);
    }

    function metadataJson(uint256 i) external pure returns (string memory) {
        return _metadataJson(_plan()[i]);
    }
}

/// @notice `ListAgents.s.sol` harus mengisi tepat tiga kategori yang kosong, dengan
///         wallet dan harga yang benar, dan metadata yang menyatakan sendiri batasnya.
contract ListAgentsScriptTest is Test {
    // Wallet Altana dari `ai/<agent>/app/agent/studio.toml` — disalin ke sini supaya
    // perubahan diam-diam di skrip gagal di test, bukan mendarat di rantai.
    address constant WALLET_REBALANCER = 0xb8f155D1278f0437b9De7c63911f2C0EDa485941;
    address constant WALLET_GRID = 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9;
    address constant WALLET_YIELD = 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866;
    address constant WALLET_GUARDIAN = 0xbdc69c2d7FE7337C86d6Ab63E1B3A89D67e5A0c0;

    ListAgentsHarness harness;
    FuguRegistry registry;

    function setUp() public {
        harness = new ListAgentsHarness();
        registry = FuguRegistry(
            address(new ERC1967Proxy(
                address(new FuguRegistry()), abi.encodeCall(FuguRegistry.initialize, (address(this)))
            ))
        );
        // Cerminkan keadaan awal testnet: satu listing HEALTH_FACTOR (Guardian) sudah
        // ada dengan `erc8004AgentId` 8004, tiga kategori lainnya kosong.
        registry.list(8004, WALLET_GUARDIAN, Category.HEALTH_FACTOR, 10_000_000, 120, "ipfs://fugu-guardian-v1");
    }

    function test_planTargetsTheThreeEmptyCategories() public view {
        ListAgents.AgentPlan[3] memory plans = harness.plan();

        assertEq(uint8(plans[0].category), uint8(Category.REBALANCING));
        assertEq(uint8(plans[1].category), uint8(Category.GRID));
        assertEq(uint8(plans[2].category), uint8(Category.YIELD));

        assertEq(plans[0].agentWallet, WALLET_REBALANCER);
        assertEq(plans[1].agentWallet, WALLET_GRID);
        assertEq(plans[2].agentWallet, WALLET_YIELD);

        // ID harus unik antar entri DAN tidak menabrak 8004 milik Guardian.
        assertEq(plans[0].erc8004AgentId, 8005);
        assertEq(plans[1].erc8004AgentId, 8006);
        assertEq(plans[2].erc8004AgentId, 8007);
    }

    /// @notice Tidak ada agent yang boleh memakai wallet agent lain — tertukarnya
    ///         wallet berarti UI menautkan aktivitas on-chain ke listing yang salah.
    function test_walletsAreDistinct() public view {
        ListAgents.AgentPlan[3] memory plans = harness.plan();
        assertTrue(plans[0].agentWallet != plans[1].agentWallet);
        assertTrue(plans[1].agentWallet != plans[2].agentWallet);
        assertTrue(plans[0].agentWallet != plans[2].agentWallet);
        assertTrue(plans[0].agentWallet != WALLET_GUARDIAN);
        assertTrue(plans[1].agentWallet != WALLET_GUARDIAN);
        assertTrue(plans[2].agentWallet != WALLET_GUARDIAN);
    }

    function test_listAllFillsAllFourCategoriesExactlyOnce() public {
        harness.listAll(registry);

        assertEq(registry.listingCount(), 4);
        assertEq(registry.countByCategory(Category.REBALANCING), 1);
        assertEq(registry.countByCategory(Category.GRID), 1);
        assertEq(registry.countByCategory(Category.YIELD), 1);
        assertEq(registry.countByCategory(Category.HEALTH_FACTOR), 1);

        // `_verifyAll` adalah gerbang yang sama yang dipakai `run()` sebelum broadcast.
        harness.verifyAll(registry);
    }

    function test_listedFieldsMatchThePlan() public {
        harness.listAll(registry);
        ListAgents.AgentPlan[3] memory plans = harness.plan();

        for (uint256 i = 0; i < plans.length; ++i) {
            uint256 listingId = registry.listingByAgentId(plans[i].erc8004AgentId);
            assertGt(listingId, 0);
            Listing memory l = registry.getListing(listingId);
            assertEq(l.erc8004AgentId, plans[i].erc8004AgentId);
            assertEq(l.agentWallet, plans[i].agentWallet);
            assertEq(uint8(l.category), uint8(plans[i].category));
            assertEq(l.priceUsd8PerPeriod, 5_000_000); // $0,05 basis 8 desimal
            assertEq(l.periodSeconds, 120);
            assertTrue(l.active);
            // `owner` = pemanggil `list()` (penerima payout), BUKAN `agentWallet`.
            assertEq(l.owner, address(harness));
            assertTrue(l.owner != l.agentWallet);
        }
    }

    /// @notice Menjalankan ulang skrip setelah sebagian tx mendarat tidak boleh
    ///         menduplikasi listing maupun revert dengan `AgentAlreadyListed`.
    function test_listAllIsIdempotent() public {
        harness.listAll(registry);
        harness.listAll(registry);

        assertEq(registry.listingCount(), 4);
        assertEq(registry.countByCategory(Category.REBALANCING), 1);
        assertEq(registry.countByCategory(Category.GRID), 1);
        assertEq(registry.countByCategory(Category.YIELD), 1);
    }

    /// @notice Metadata wajib JSON sah dan wajib menyatakan sendiri bahwa ketiga agent
    ///         ini belum tersambung ke eksekusi on-chain (`docs/STATUS.md` §B3).
    function test_metadataDeclaresNoOnchainExecution() public view {
        ListAgents.AgentPlan[3] memory plans = harness.plan();
        string[3] memory expectedCategory = ["REBALANCING", "GRID", "YIELD"];

        for (uint256 i = 0; i < plans.length; ++i) {
            string memory json = harness.metadataJson(i);
            assertFalse(vm.parseJsonBool(json, ".onchainExecution"));
            assertEq(vm.parseJsonString(json, ".category"), expectedCategory[i]);
            assertEq(vm.parseJsonString(json, ".name"), plans[i].name);
            assertEq(vm.parseJsonString(json, ".agent"), plans[i].slug);
            assertEq(vm.parseJsonAddress(json, ".agentWallet"), plans[i].agentWallet);
            assertGt(bytes(vm.parseJsonString(json, ".limits")).length, 0);
            assertGt(bytes(vm.parseJsonString(json, ".verify")).length, 0);
            assertGt(bytes(vm.parseJsonString(json, ".erc8004Identity")).length, 0);
        }
    }

    /// @notice `metadataURI` harus `data:` URI yang berdiri sendiri — bukan `ipfs://`
    ///         yang tidak pernah bisa di-resolve siapa pun.
    function test_metadataIsSelfContainedDataUri() public view {
        for (uint256 i = 0; i < 3; ++i) {
            bytes memory uri = bytes(harness.metadata(i));
            string memory prefix = "data:application/json;base64,";
            bytes memory expected = bytes(prefix);
            assertGt(uri.length, expected.length);
            for (uint256 j = 0; j < expected.length; ++j) {
                assertEq(uri[j], expected[j]);
            }
            // Panjang base64 = 4 * ceil(n / 3).
            uint256 jsonLen = bytes(harness.metadataJson(i)).length;
            assertEq(uri.length - expected.length, 4 * ((jsonLen + 2) / 3));
        }
    }

    /// @notice Harga nol ditolak kontrak (`InvalidPrice`) — rencana tidak boleh
    ///         mengandalkan nilai yang akan revert di jaringan.
    function test_priceAndPeriodAreAcceptedByTheRegistry() public {
        harness.listAll(registry);
        Listing memory l = registry.getListing(registry.listingByAgentId(8005));
        assertGt(l.priceUsd8PerPeriod, 0);
        assertGt(l.periodSeconds, 0);
    }
}
