// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {Category, Listing} from "../src/types/FuguTypes.sol";

/// @title ListAgents
/// @notice Daftarkan tiga agent Fugugent yang belum ada di `FuguRegistry` —
///         Rebalancer (REBALANCING), Grid (GRID), Yield (YIELD) — supaya keempat
///         kategori marketplace terisi, bukan cuma HEALTH_FACTOR.
///
/// @dev Cara pakai (SELALU simulasi dulu, tanpa `--broadcast`, dan baca keluarannya):
///
///      ```
///      cd contracts
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL"
///      forge script script/ListAgents.s.sol:ListAgents --rpc-url "$BSC_TESTNET_RPC_URL" --broadcast
///      ```
///
///      ## Idempoten — tidak seperti `DeployMocks.s.sol`
///
///      Setiap entri dilewati bila `erc8004AgentId`-nya sudah terpetakan ke sebuah
///      listing (`listingByAgentId != 0`). Menjalankan ulang skrip ini karena satu tx
///      gagal karena itu tidak menduplikasi listing yang sudah mendarat, dan tidak
///      membakar tBNB untuk transaksi yang pasti revert dengan `AgentAlreadyListed`.
///
///      ## `erc8004AgentId` di sini adalah PLACEHOLDER, bukan identitas ERC-8004 nyata
///
///      Tidak satu pun wallet agent kita memegang token IdentityRegistry ERC-8004 di
///      BSC testnet (`balanceOf` pada `0x8004A818BFB912233c491871b3d84c89A494BD9e` = 0
///      untuk keempatnya, per 2026-09-09). ID 8005/8006/8007 melanjutkan `8004` yang
///      sudah dipakai listing Guardian: sekadar kunci unik lokal. `FuguRegistry`
///      memang tidak memverifikasi kepemilikan ERC-8004 (lihat NatSpec kontraknya),
///      jadi ID ini TIDAK boleh dibaca sebagai bukti identitas. Fakta itu ikut ditulis
///      ke dalam metadata masing-masing listing, bukan hanya ke dokumen.
///
///      ## Metadata ditanam on-chain sebagai `data:` URI
///
///      `metadataURI` bukan `ipfs://...` yang tidak pernah bisa di-resolve; isinya
///      JSON base64 yang bisa dibaca siapa pun tanpa server, IPFS, atau API key:
///
///      ```
///      cast call --rpc-url "$BSC_TESTNET_RPC_URL" 0xb2f36070E6eae3353E8e755172B477DF213ae248 \
///        'getListing(uint256)((uint256,address,address,uint8,uint128,uint32,bool,bool,string))' 2 \
///        | sed -E 's/.*base64,//; s/"\)$//' | base64 -d
///      ```
///
///      Metadata itu menyatakan sendiri batas ketiga agent ini: mesin keputusan +
///      backtest, **belum tersambung ke eksekusi on-chain**, dan belum pernah
///      mengirim satu transaksi pun (`docs/STATUS.md` §B3). Marketplace tidak boleh
///      mengklaim lebih dari itu.
///
///      `chainId` di-hardcode ke 97 (BSC testnet). **Ubah saat dipakai untuk mainnet.**
contract ListAgents is Script {
    /// @dev BSC testnet. Ganti ke 56 untuk mainnet.
    uint256 constant EXPECTED_CHAIN_ID = 97;

    /// @dev Proxy FuguRegistry — terverifikasi live, lihat `deployments/bsc-testnet.json`.
    address constant REGISTRY = 0xb2f36070E6eae3353E8e755172B477DF213ae248;

    /// @dev IdentityRegistry ERC-8004 kanonik di BSC testnet, dirujuk di metadata
    ///      supaya pembaca bisa memeriksa sendiri bahwa kami BELUM punya token identitas.
    address constant ERC8004_IDENTITY_REGISTRY = 0x8004A818BFB912233c491871b3d84c89A494BD9e;

    /// @dev Harga langganan basis 8 desimal: 5_000_000 = $0,05 per periode.
    ///
    ///      Setengah dari listing Guardian ($0,10) dan disengaja: Guardian sudah
    ///      terbukti mengeksekusi transaksi on-chain, ketiga agent ini baru mesin
    ///      keputusan. Selisih harganya menyatakan selisih kemampuan yang sama yang
    ///      ditulis di metadata — bukan angka yang dipilih supaya kelihatan bagus.
    ///      Nol dilarang kontrak (`InvalidPrice`), dan harga sekecil ini tetap
    ///      membuat escrow/claim/fee 5% berjalan dengan angka bukan-nol.
    uint128 constant PRICE_USD8 = 5_000_000;

    /// @dev Periode 120 detik, sama dengan listing Guardian yang sudah live.
    ///
    ///      Pendek BUKAN karena ini harga komersial ($0,05/2 menit tentu bukan),
    ///      tetapi karena gerbang anti-sybil `FuguSubscription.hasSubscribed` baru
    ///      terbuka setelah agent benar-benar MENERIMA >= `minPaidBpsOfPeriod` (50%)
    ///      dari harga SATU periode, dan `claim` proporsional terhadap waktu berjalan.
    ///      Periode 30 hari berarti hak review baru terbuka setelah 15 hari — siklus
    ///      sewa → claim → review tidak akan pernah selesai di depan juri. 120 detik
    ///      membuatnya selesai dalam ~60 detik. Keempat kartu juga jadi sebanding
    ///      karena memakai periode yang sama.
    uint32 constant PERIOD_SECONDS = 120;

    /// @dev 1 listing Guardian yang sudah ada + 3 yang didaftarkan skrip ini.
    uint256 constant EXPECTED_TOTAL_LISTINGS = 4;

    error WrongChain(uint256 expected, uint256 actual);
    error NoCode(string label, address addr);
    error ListingMismatch(uint256 listingId, string field);
    error UnexpectedListingCount(uint256 expected, uint256 actual);
    error UnexpectedCategoryCount(uint8 category, uint256 expected, uint256 actual);

    struct AgentPlan {
        uint256 erc8004AgentId;
        address agentWallet;
        Category category;
        /// @dev Nama tampilan, sama dengan yang dipakai marketplace.
        string name;
        /// @dev Direktori agent di `ai/<slug>/app/agent` — dipakai di perintah bukti.
        string slug;
        /// @dev Apa yang benar-benar dilakukan mesin keputusannya, dengan ambang yang
        ///      diturunkan (bukan ditebak). Diringkas dari `docs/STATUS.md` §A5.
        string summary;
        /// @dev Jumlah test yang bisa dijalankan ulang pembaca.
        string testCount;
    }

    function run() external {
        if (block.chainid != EXPECTED_CHAIN_ID) revert WrongChain(EXPECTED_CHAIN_ID, block.chainid);
        if (REGISTRY.code.length == 0) revert NoCode("REGISTRY", REGISTRY);

        uint256 pk = vm.envUint("PRIVATE_KEY");
        address lister = vm.addr(pk);
        FuguRegistry registry = FuguRegistry(REGISTRY);

        console.log("== Konteks (periksa sebelum --broadcast) ==");
        console.log("chainId               ", block.chainid);
        console.log("FuguRegistry          ", REGISTRY);
        console.log("lister (owner listing)", lister);
        console.log("saldo lister (wei)    ", lister.balance);
        console.log("listingCount sebelum  ", registry.listingCount());
        console.log("harga (USD 8 desimal) ", uint256(PRICE_USD8));
        console.log("periode (detik)       ", uint256(PERIOD_SECONDS));

        vm.startBroadcast(pk);
        _listAll(registry);
        vm.stopBroadcast();

        _verifyAll(registry);
        _logResult(registry);
    }

    /// @notice Daftarkan seluruh entri rencana yang belum terdaftar.
    /// @dev Dipisah dari `run()` supaya jalur yang persis sama bisa diuji terhadap
    ///      `FuguRegistry` lokal (`test/ListAgentsScript.t.sol`) tanpa env var, tanpa
    ///      broadcast, dan tanpa membelanjakan tBNB untuk menemukan argumen tertukar.
    function _listAll(FuguRegistry registry) internal {
        AgentPlan[3] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 existing = registry.listingByAgentId(p.erc8004AgentId);
            if (existing != 0) {
                console.log("dilewati (sudah terdaftar):", p.name, existing);
                continue;
            }
            uint256 listingId = registry.list(
                p.erc8004AgentId, p.agentWallet, p.category, PRICE_USD8, PERIOD_SECONDS, _metadata(p)
            );
            console.log("terdaftar:", p.name, listingId);
        }
    }

    /// @notice Gagal keras kalau hasil on-chain tidak persis seperti rencana.
    /// @dev Dijalankan juga saat simulasi (`forge script` tanpa `--broadcast`), jadi
    ///      ketidakcocokan membatalkan seluruh jalan SEBELUM satu tx pun dikirim.
    function _verifyAll(FuguRegistry registry) internal view {
        AgentPlan[3] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            AgentPlan memory p = plans[i];
            uint256 listingId = registry.listingByAgentId(p.erc8004AgentId);
            if (listingId == 0) revert ListingMismatch(0, "belum terdaftar");
            _verifyListing(registry, listingId, p);
        }

        uint256 total = registry.listingCount();
        if (total != EXPECTED_TOTAL_LISTINGS) revert UnexpectedListingCount(EXPECTED_TOTAL_LISTINGS, total);

        // Keempat kategori harus terisi tepat satu: itulah alasan skrip ini ada.
        for (uint8 c = 0; c <= uint8(Category.HEALTH_FACTOR); ++c) {
            uint256 n = registry.countByCategory(Category(c));
            if (n != 1) revert UnexpectedCategoryCount(c, 1, n);
        }
    }

    function _verifyListing(FuguRegistry registry, uint256 listingId, AgentPlan memory p) internal view {
        Listing memory l = registry.getListing(listingId);
        if (l.erc8004AgentId != p.erc8004AgentId) revert ListingMismatch(listingId, "erc8004AgentId");
        if (l.agentWallet != p.agentWallet) revert ListingMismatch(listingId, "agentWallet");
        if (l.category != p.category) revert ListingMismatch(listingId, "category");
        if (l.priceUsd8PerPeriod != PRICE_USD8) revert ListingMismatch(listingId, "priceUsd8PerPeriod");
        if (l.periodSeconds != PERIOD_SECONDS) revert ListingMismatch(listingId, "periodSeconds");
        if (!l.active) revert ListingMismatch(listingId, "active");
        if (bytes(l.metadataURI).length == 0) revert ListingMismatch(listingId, "metadataURI");
    }

    /// @notice Rencana pendaftaran. Wallet diambil dari `ai/<slug>/app/agent/studio.toml`.
    /// @dev Kategori WAJIB cocok dengan indeks enum di `src/types/FuguTypes.sol`:
    ///      0 REBALANCING, 1 GRID, 2 YIELD, 3 HEALTH_FACTOR (Guardian, sudah live).
    function _plan() internal pure returns (AgentPlan[3] memory plans) {
        plans[0] = AgentPlan({
            erc8004AgentId: 8005,
            agentWallet: 0xb8f155D1278f0437b9De7c63911f2C0EDa485941,
            category: Category.REBALANCING,
            name: "Fugu Rebalancer",
            slug: "fugurebalancer",
            summary: "Drift-band rebalancer: a 500 bps band plus a 50 bps cost gate on turnover. The minimum economic turnover is derived from gas and budget (T >= gas * 10000 / (M - r)) and returns null when the budget makes rebalancing impossible, instead of quietly never trading.",
            testCount: "88"
        });
        plans[1] = AgentPlan({
            erc8004AgentId: 8006,
            agentWallet: 0x2AA59d5cf540c8f1b1CE4C667C2e745475d4EAd9,
            category: Category.GRID,
            name: "Fugu Grid",
            slug: "fugugrid",
            summary: "Grid trading on PancakeSwap v3: line spacing must be at least 2x the round-trip cost, measured at the upper bound where percentage spacing is tightest. Structurally mean-reverting, so its own backtest shows buy-and-hold beating it in a trending market.",
            testCount: "99"
        });
        plans[2] = AgentPlan({
            erc8004AgentId: 8007,
            agentWallet: 0x15dE73F47Ca58a11A6Ef9dB24dfDc6F096b0a866,
            category: Category.YIELD,
            name: "Fugu Yield",
            slug: "fuguyield",
            summary: "Pool migration gated by breakEvenSpreadBps = ceil(cost * 10000 * 365 / (principal * days)) times a 2.00x safety multiplier. The threshold rises as principal or horizon shrinks ($10,000 over 30 days needs 390 bps, $200 needs 1582 bps), so highest APY is not the answer.",
            testCount: "93"
        });
    }

    /// @notice Metadata listing sebagai `data:application/json;base64,...`.
    /// @dev Isinya sengaja menyebut apa yang BELUM ada. `onchainExecution: false` dan
    ///      `limits` adalah kalimat yang sama dengan `docs/STATUS.md` §B3 — marketplace
    ///      tidak boleh bertentangan dengan dokumen kejujuran kita sendiri.
    function _metadata(AgentPlan memory p) internal pure returns (string memory) {
        return string.concat("data:application/json;base64,", Base64.encode(bytes(_metadataJson(p))));
    }

    /// @notice JSON mentah sebelum dibungkus base64.
    /// @dev Dipisah supaya test bisa mem-parse-nya dengan `vm.parseJson*` — yang
    ///      sekaligus membuktikan hasilnya JSON sah, bukan string yang kebetulan mirip.
    function _metadataJson(AgentPlan memory p) internal pure returns (string memory) {
        return string.concat(
            '{"name":"', p.name,
            '","agent":"', p.slug,
            '","category":"', _categoryName(p.category),
            '","agentWallet":"', vm.toString(p.agentWallet),
            '","summary":"', p.summary,
            '","onchainExecution":false',
            ',"limits":"Deterministic decision engine and backtest only. This agent has never sent an on-chain transaction. Hiring it records payment in escrow and does not start an autonomous loop yet. See docs/STATUS.md section B3."',
            ',"verify":"cd ai/', p.slug, '/app/agent && corepack pnpm test  # ', p.testCount, ' tests"',
            ',"erc8004Identity":"placeholder id, locally unique in FuguRegistry only: no ERC-8004 IdentityRegistry token has been minted for this wallet at ', vm.toString(ERC8004_IDENTITY_REGISTRY),
            '","chainId":97}'
        );
    }

    function _categoryName(Category c) internal pure returns (string memory) {
        if (c == Category.REBALANCING) return "REBALANCING";
        if (c == Category.GRID) return "GRID";
        if (c == Category.YIELD) return "YIELD";
        return "HEALTH_FACTOR";
    }

    function _logResult(FuguRegistry registry) internal view {
        console.log("== Hasil (dibaca ulang dari rantai) ==");
        console.log("listingCount          ", registry.listingCount());
        console.log("countByCategory(0) REBALANCING  ", registry.countByCategory(Category.REBALANCING));
        console.log("countByCategory(1) GRID         ", registry.countByCategory(Category.GRID));
        console.log("countByCategory(2) YIELD        ", registry.countByCategory(Category.YIELD));
        console.log("countByCategory(3) HEALTH_FACTOR", registry.countByCategory(Category.HEALTH_FACTOR));

        AgentPlan[3] memory plans = _plan();
        for (uint256 i = 0; i < plans.length; ++i) {
            uint256 listingId = registry.listingByAgentId(plans[i].erc8004AgentId);
            Listing memory l = registry.getListing(listingId);
            console.log("--", plans[i].name);
            console.log("  listingId       ", listingId);
            console.log("  erc8004AgentId  ", l.erc8004AgentId);
            console.log("  category (enum) ", uint256(uint8(l.category)));
            console.log("  priceUsd8       ", uint256(l.priceUsd8PerPeriod));
            console.log("  periodSeconds   ", uint256(l.periodSeconds));
            console.log("  owner           ", l.owner);
            console.log("  agentWallet     ", l.agentWallet);
            console.log("  metadataURI len ", bytes(l.metadataURI).length);
        }
    }
}
