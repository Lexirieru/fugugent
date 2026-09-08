# Fugugent Smart Contracts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Empat kontrak UUPS upgradeable di BSC testnet yang menjadi lapisan komersial Fugugent: katalog agent terkurasi, langganan escrow multi-token berbasis harga USD dengan klaim pro-rata dan revenue share, serta reputasi anti-sybil.

**Architecture:** Empat kontrak terpisah dengan tanggung jawab tunggal, dihubungkan lewat alamat yang di-set saat inisialisasi. `FuguPriceOracle` mengubah harga USD menjadi jumlah token lewat Chainlink. `FuguRegistry` memegang katalog. `FuguSubscription` memegang uang dan satu-satunya yang menyentuh dana. `FuguReputation` membaca `FuguSubscription` untuk membuktikan hak review. Semua UUPS + Ownable, storage append-only.

**Tech Stack:** Solidity 0.8.30, Foundry (forge 1.7.1), OpenZeppelin Contracts & Contracts-Upgradeable 5.7.0, BSC testnet (chainId 97).

**Spec:** `docs/specs/2026-09-08-fugugent-design.md` (§4)

## Global Constraints

- Solidity pragma **`^0.8.30`** di semua file `src/`.
- OpenZeppelin **5.7.0**. Parent OZ memakai ERC-7201 namespaced storage, sehingga **tidak** menggeser slot storage kontrak turunan. Karena itu **jangan tulis `__gap`** — cukup patuhi aturan **append-only**: variabel state baru hanya boleh ditambahkan di akhir, tidak pernah disisipkan atau dihapus.
- Semua kontrak: `Initializable` + `UUPSUpgradeable` + `OwnableUpgradeable`, dengan `_disableInitializers()` di `constructor`.
- `_authorizeUpgrade(address) internal override onlyOwner {}` di setiap kontrak.
- Harga USD selalu **8 desimal** (mengikuti Chainlink). Variabel bernama akhiran `Usd8`.
- **Semua token di BSC 18 desimal, termasuk USDT.** Jangan pernah hardcode 6.
- Native coin (tBNB) diwakili `address(0)`.
- Custom errors, bukan `require` string.
- Setiap kontrak punya file test sendiri di `contracts/test/`.
- Nama file test: `<Kontrak>.t.sol`. Nama kontrak test: `<Kontrak>Test`.
- Perintah dijalankan dari `contracts/`.

---

## File Structure

| File | Tanggung jawab |
|---|---|
| `contracts/src/FuguPriceOracle.sol` | Konversi USD(8) → jumlah token, via Chainlink atau harga tetap. Tidak menyentuh dana. |
| `contracts/src/FuguRegistry.sol` | Katalog listing agent: kategori, harga, kepemilikan, kurasi. Tidak menyentuh dana. |
| `contracts/src/FuguSubscription.sol` | Satu-satunya kontrak yang memegang dana. Escrow, klaim pro-rata, refund, revenue share. |
| `contracts/src/FuguReputation.sol` | Review ber-gate bukti langganan. Tidak menyentuh dana. |
| `contracts/src/interfaces/IAggregatorV3.sol` | Antarmuka minimal Chainlink. |
| `contracts/src/interfaces/IFuguRegistry.sol` | Antarmuka yang dikonsumsi Subscription. |
| `contracts/src/interfaces/IFuguSubscription.sol` | Antarmuka yang dikonsumsi Reputation. |
| `contracts/test/mocks/MockAggregator.sol` | Feed Chainlink palsu yang bisa diatur harga & waktunya. |
| `contracts/test/mocks/MockERC20.sol` | Token 18 desimal untuk test. |
| `contracts/test/FuguPriceOracle.t.sol` | Test oracle. |
| `contracts/test/FuguRegistry.t.sol` | Test katalog. |
| `contracts/test/FuguSubscription.t.sol` | Test escrow — yang paling kritis. |
| `contracts/test/FuguReputation.t.sol` | Test gating review. |
| `contracts/script/Deploy.s.sol` | Deploy 4 proxy + konfigurasi awal. |
| `contracts/script/Upgrade.s.sol` | Upgrade satu implementasi. |
| `contracts/deployments/bsc-testnet.json` | Alamat hasil deploy (ditulis manual dari output). |

---

### Task 1: Bersihkan scaffold & siapkan fondasi test

**Files:**
- Delete: `contracts/src/Counter.sol`, `contracts/test/Counter.t.sol`, `contracts/script/Counter.s.sol`
- Modify: `contracts/foundry.toml`
- Create: `contracts/src/interfaces/IAggregatorV3.sol`
- Create: `contracts/test/mocks/MockAggregator.sol`
- Create: `contracts/test/mocks/MockERC20.sol`

**Interfaces:**
- Consumes: tidak ada
- Produces: `IAggregatorV3.latestRoundData()`, `MockAggregator(int256 price, uint8 decimals)` dengan `setPrice(int256)` dan `setUpdatedAt(uint256)`; `MockERC20(string name, string symbol)` dengan `mint(address,uint256)` dan 18 desimal.

- [ ] **Step 1: Hapus scaffold bawaan**

```bash
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
```

- [ ] **Step 2: Pin compiler dan aktifkan optimizer di `foundry.toml`**

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.30"
optimizer = true
optimizer_runs = 200
via_ir = false
ffi = false

[profile.default.fuzz]
runs = 256

[rpc_endpoints]
bsc_testnet = "${BSC_TESTNET_RPC_URL}"

[etherscan]
bsc_testnet = { key = "${BSCSCAN_API_KEY}", chain = 97, url = "https://api-testnet.bscscan.com/api" }
```

- [ ] **Step 3: Tulis antarmuka Chainlink**

`src/interfaces/IAggregatorV3.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function description() external view returns (string memory);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
```

- [ ] **Step 4: Tulis mock aggregator**

`test/mocks/MockAggregator.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

contract MockAggregator is IAggregatorV3 {
    uint8 private _decimals;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 decimals_, int256 answer_) {
        _decimals = decimals_;
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    function setPrice(int256 answer_) external {
        _answer = answer_;
        _updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 updatedAt_) external {
        _updatedAt = updatedAt_;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "mock";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
```

- [ ] **Step 5: Tulis mock ERC20 (18 desimal)**

`test/mocks/MockERC20.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 6: Verifikasi build bersih**

Run: `forge build`
Expected: `Compiler run successful!` tanpa error.

- [ ] **Step 7: Commit**

```bash
git add contracts/
git commit -m "chore(contracts): hapus scaffold, tambah mock dan antarmuka Chainlink"
```

---

### Task 2: `FuguPriceOracle`

**Files:**
- Create: `contracts/src/FuguPriceOracle.sol`
- Test: `contracts/test/FuguPriceOracle.t.sol`

**Interfaces:**
- Consumes: `IAggregatorV3`, `MockAggregator`
- Produces:
  - `enum PriceSourceKind { NONE, CHAINLINK, FIXED_USD }`
  - `struct TokenConfig { PriceSourceKind kind; address feed; uint32 maxStaleness; uint8 tokenDecimals; uint64 fixedPriceUsd8; bool enabled; }`
  - `function initialize(address owner_) external`
  - `function setToken(address token, TokenConfig calldata cfg) external`
  - `function quote(address token, uint256 usdAmount8) external view returns (uint256 tokenAmount)`
  - `function priceUsd8(address token) external view returns (uint256)`
  - Errors: `TokenNotEnabled(address)`, `StalePrice(address,uint256)`, `InvalidPrice(int256)`, `InvalidConfig()`

**Rumus konversi (satu-satunya sumber kebenaran):**
```
tokenAmount = usdAmount8 * 10^tokenDecimals / priceUsd8
```
`priceUsd8` dinormalisasi ke 8 desimal dari `feed.decimals()`.

- [ ] **Step 1: Tulis test yang gagal**

`test/FuguPriceOracle.t.sol`:
```solidity
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
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `forge test --match-contract FuguPriceOracleTest`
Expected: gagal kompilasi — `FuguPriceOracle` belum ada.

- [ ] **Step 3: Implementasi**

`src/FuguPriceOracle.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title FuguPriceOracle
/// @notice Mengubah jumlah USD (8 desimal) menjadi jumlah token pembayaran.
/// @dev Ambang staleness disimpan per token karena tiap feed punya heartbeat
///      berbeda: di BSC testnet BNB/USD update jauh lebih sering daripada USDT/USD.
contract FuguPriceOracle is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    enum PriceSourceKind {
        NONE,
        CHAINLINK,
        FIXED_USD
    }

    struct TokenConfig {
        PriceSourceKind kind;
        address feed;
        uint32 maxStaleness;
        uint8 tokenDecimals;
        uint64 fixedPriceUsd8;
        bool enabled;
    }

    /// @dev address(0) berarti native coin (tBNB).
    mapping(address token => TokenConfig) private _tokens;

    event TokenConfigured(address indexed token, PriceSourceKind kind, address feed, bool enabled);

    error TokenNotEnabled(address token);
    error StalePrice(address token, uint256 updatedAt);
    error InvalidPrice(int256 answer);
    error InvalidConfig();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
    }

    function setToken(address token, TokenConfig calldata cfg) external onlyOwner {
        if (cfg.kind == PriceSourceKind.CHAINLINK) {
            if (cfg.feed == address(0) || cfg.maxStaleness == 0) revert InvalidConfig();
        } else if (cfg.kind == PriceSourceKind.FIXED_USD) {
            if (cfg.fixedPriceUsd8 == 0) revert InvalidConfig();
        } else {
            revert InvalidConfig();
        }
        if (cfg.tokenDecimals == 0 || cfg.tokenDecimals > 36) revert InvalidConfig();

        _tokens[token] = cfg;
        emit TokenConfigured(token, cfg.kind, cfg.feed, cfg.enabled);
    }

    function tokenConfig(address token) external view returns (TokenConfig memory) {
        return _tokens[token];
    }

    /// @notice Harga satu unit token dalam USD, 8 desimal.
    function priceUsd8(address token) public view returns (uint256) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);

        if (cfg.kind == PriceSourceKind.FIXED_USD) {
            return cfg.fixedPriceUsd8;
        }

        IAggregatorV3 feed = IAggregatorV3(cfg.feed);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (block.timestamp - updatedAt > cfg.maxStaleness) revert StalePrice(token, updatedAt);

        uint256 feedDecimals = feed.decimals();
        uint256 price = uint256(answer);
        if (feedDecimals > 8) {
            price = price / (10 ** (feedDecimals - 8));
        } else if (feedDecimals < 8) {
            price = price * (10 ** (8 - feedDecimals));
        }
        if (price == 0) revert InvalidPrice(answer);
        return price;
    }

    /// @notice Berapa banyak `token` yang setara dengan `usdAmount8` USD.
    function quote(address token, uint256 usdAmount8) external view returns (uint256 tokenAmount) {
        TokenConfig memory cfg = _tokens[token];
        if (!cfg.enabled) revert TokenNotEnabled(token);
        uint256 price = priceUsd8(token);
        tokenAmount = (usdAmount8 * (10 ** cfg.tokenDecimals)) / price;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 4: Jalankan test sampai hijau**

Run: `forge test --match-contract FuguPriceOracleTest -vv`
Expected: semua PASS.

Catatan bila `test_revertsOnStalePrice` gagal karena underflow: pastikan `vm.warp` di `setUp` sudah membuat `block.timestamp` cukup besar (sudah, 1_700_000_000).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/FuguPriceOracle.sol contracts/test/FuguPriceOracle.t.sol
git commit -m "feat(contracts): FuguPriceOracle dengan staleness per-token"
```

---

### Task 3: `FuguRegistry`

**Files:**
- Create: `contracts/src/FuguRegistry.sol`
- Create: `contracts/src/interfaces/IFuguRegistry.sol`
- Test: `contracts/test/FuguRegistry.t.sol`

**Interfaces:**
- Consumes: tidak ada kontrak lain
- Produces:
  - `enum Category { REBALANCING, GRID, YIELD, HEALTH_FACTOR }`
  - `struct Listing { uint256 erc8004AgentId; address owner; address agentWallet; Category category; uint128 priceUsd8PerPeriod; uint32 periodSeconds; bool active; bool curated; string metadataURI; }`
  - `function list(uint256 erc8004AgentId, address agentWallet, Category category, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string calldata metadataURI) external returns (uint256 listingId)`
  - `function getListing(uint256 listingId) external view returns (Listing memory)`
  - `function listingCount() external view returns (uint256)`
  - `function countByCategory(Category) external view returns (uint256)`
  - Errors: `NotListingOwner(uint256)`, `ListingNotFound(uint256)`, `InvalidPeriod()`, `NotCurator()`

`IFuguRegistry` mengekspos `getListing` dan tipe-tipenya untuk dikonsumsi `FuguSubscription`.

- [ ] **Step 1: Tulis test yang gagal**

`test/FuguRegistry.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";

contract FuguRegistryTest is Test {
    FuguRegistry registry;
    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address stranger = address(0xBAD);

    function setUp() public {
        FuguRegistry impl = new FuguRegistry();
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );
    }

    function _list(address as_, FuguRegistry.Category cat) internal returns (uint256) {
        vm.prank(as_);
        return registry.list(42, address(0xA6E17), cat, 5_00000000, 30 days, "ipfs://meta");
    }

    function test_listAssignsSequentialIds() public {
        assertEq(_list(creator, FuguRegistry.Category.REBALANCING), 1);
        assertEq(_list(creator, FuguRegistry.Category.GRID), 2);
        assertEq(registry.listingCount(), 2);
    }

    function test_listStoresAllFields() public {
        uint256 id = _list(creator, FuguRegistry.Category.HEALTH_FACTOR);
        FuguRegistry.Listing memory l = registry.getListing(id);
        assertEq(l.erc8004AgentId, 42);
        assertEq(l.owner, creator);
        assertEq(uint8(l.category), uint8(FuguRegistry.Category.HEALTH_FACTOR));
        assertEq(l.priceUsd8PerPeriod, 5_00000000);
        assertEq(l.periodSeconds, 30 days);
        assertTrue(l.active);
        assertFalse(l.curated);
        assertEq(l.metadataURI, "ipfs://meta");
    }

    function test_countByCategoryTracksParity() public {
        _list(creator, FuguRegistry.Category.REBALANCING);
        _list(creator, FuguRegistry.Category.GRID);
        _list(creator, FuguRegistry.Category.GRID);
        assertEq(registry.countByCategory(FuguRegistry.Category.REBALANCING), 1);
        assertEq(registry.countByCategory(FuguRegistry.Category.GRID), 2);
        assertEq(registry.countByCategory(FuguRegistry.Category.YIELD), 0);
    }

    function test_revertsOnZeroPeriod() public {
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.InvalidPeriod.selector);
        registry.list(1, address(0xA6E17), FuguRegistry.Category.YIELD, 1e8, 0, "");
    }

    function test_onlyOwnerCanUpdateListing() public {
        uint256 id = _list(creator, FuguRegistry.Category.YIELD);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.NotListingOwner.selector, id));
        registry.setActive(id, false);
    }

    function test_listingOwnerCanDeactivate() public {
        uint256 id = _list(creator, FuguRegistry.Category.YIELD);
        vm.prank(creator);
        registry.setActive(id, false);
        assertFalse(registry.getListing(id).active);
    }

    function test_onlyCuratorCanCurate() public {
        uint256 id = _list(creator, FuguRegistry.Category.YIELD);
        vm.prank(creator);
        vm.expectRevert(FuguRegistry.NotCurator.selector);
        registry.setCurated(id, true);

        vm.prank(owner);
        registry.setCurator(stranger, true);
        vm.prank(stranger);
        registry.setCurated(id, true);
        assertTrue(registry.getListing(id).curated);
    }

    function test_getListingRevertsForUnknownId() public {
        vm.expectRevert(abi.encodeWithSelector(FuguRegistry.ListingNotFound.selector, uint256(99)));
        registry.getListing(99);
    }
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `forge test --match-contract FuguRegistryTest`
Expected: gagal kompilasi.

- [ ] **Step 3: Tulis antarmuka**

`src/interfaces/IFuguRegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IFuguRegistry {
    enum Category {
        REBALANCING,
        GRID,
        YIELD,
        HEALTH_FACTOR
    }

    struct Listing {
        uint256 erc8004AgentId;
        address owner;
        address agentWallet;
        Category category;
        uint128 priceUsd8PerPeriod;
        uint32 periodSeconds;
        bool active;
        bool curated;
        string metadataURI;
    }

    function getListing(uint256 listingId) external view returns (Listing memory);
    function listingCount() external view returns (uint256);
}
```

- [ ] **Step 4: Implementasi**

`src/FuguRegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";

/// @title FuguRegistry
/// @notice Katalog agent yang layak ditampilkan di marketplace, menjembatani
///         identitas ERC-8004 yang mentah dengan listing yang punya harga dan kategori.
contract FuguRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, IFuguRegistry {
    uint256 private _listingCount;
    mapping(uint256 listingId => Listing) private _listings;
    mapping(Category => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    event Listed(uint256 indexed listingId, address indexed owner, Category indexed category, uint256 erc8004AgentId);
    event ListingUpdated(uint256 indexed listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI);
    event ActiveChanged(uint256 indexed listingId, bool active);
    event CuratedChanged(uint256 indexed listingId, bool curated);
    event CuratorChanged(address indexed curator, bool allowed);

    error NotListingOwner(uint256 listingId);
    error ListingNotFound(uint256 listingId);
    error InvalidPeriod();
    error NotCurator();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
    }

    modifier onlyListingOwner(uint256 listingId) {
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        if (_listings[listingId].owner != msg.sender) revert NotListingOwner(listingId);
        _;
    }

    function list(
        uint256 erc8004AgentId,
        address agentWallet,
        Category category,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external returns (uint256 listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();

        listingId = ++_listingCount;
        _listings[listingId] = Listing({
            erc8004AgentId: erc8004AgentId,
            owner: msg.sender,
            agentWallet: agentWallet,
            category: category,
            priceUsd8PerPeriod: priceUsd8PerPeriod,
            periodSeconds: periodSeconds,
            active: true,
            curated: false,
            metadataURI: metadataURI
        });
        unchecked {
            ++_countByCategory[category];
        }
        emit Listed(listingId, msg.sender, category, erc8004AgentId);
    }

    function updateListing(
        uint256 listingId,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external onlyListingOwner(listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();
        Listing storage l = _listings[listingId];
        l.priceUsd8PerPeriod = priceUsd8PerPeriod;
        l.periodSeconds = periodSeconds;
        l.metadataURI = metadataURI;
        emit ListingUpdated(listingId, priceUsd8PerPeriod, periodSeconds, metadataURI);
    }

    function setActive(uint256 listingId, bool active) external onlyListingOwner(listingId) {
        _listings[listingId].active = active;
        emit ActiveChanged(listingId, active);
    }

    function setCurator(address curator, bool allowed) external onlyOwner {
        isCurator[curator] = allowed;
        emit CuratorChanged(curator, allowed);
    }

    function setCurated(uint256 listingId, bool curated) external {
        if (!isCurator[msg.sender]) revert NotCurator();
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        _listings[listingId].curated = curated;
        emit CuratedChanged(listingId, curated);
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        return _listings[listingId];
    }

    function listingCount() external view returns (uint256) {
        return _listingCount;
    }

    function countByCategory(Category category) external view returns (uint256) {
        return _countByCategory[category];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 5: Jalankan test sampai hijau**

Run: `forge test --match-contract FuguRegistryTest -vv`
Expected: semua PASS.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/FuguRegistry.sol contracts/src/interfaces/IFuguRegistry.sol contracts/test/FuguRegistry.t.sol
git commit -m "feat(contracts): FuguRegistry katalog agent per kategori"
```

---

### Task 4: `FuguSubscription` — escrow, pro-rata, revenue share

Ini kontrak paling kritis: satu-satunya yang memegang dana. Kerjakan pelan-pelan.

**Files:**
- Create: `contracts/src/FuguSubscription.sol`
- Create: `contracts/src/interfaces/IFuguSubscription.sol`
- Test: `contracts/test/FuguSubscription.t.sol`

**Interfaces:**
- Consumes: `IFuguRegistry.getListing`, `FuguPriceOracle.quote`
- Produces:
  - `struct Sub { uint256 listingId; address subscriber; address payToken; uint128 deposited; uint128 claimed; uint64 startedAt; uint64 endsAt; bool cancelled; }`
  - `function subscribe(uint256 listingId, uint32 periods, address payToken) external payable returns (uint256 subId)`
  - `function claimable(uint256 subId) external view returns (uint256)`
  - `function claim(uint256 subId) external`
  - `function cancel(uint256 subId) external`
  - `function hasSubscribed(uint256 listingId, address user) external view returns (bool)`
  - Errors: `ListingInactive()`, `ZeroPeriods()`, `WrongNativeAmount(uint256,uint256)`, `NotSubscriber()`, `AlreadyCancelled()`, `NothingToClaim()`, `TransferFailed()`

**Aturan pro-rata (satu-satunya sumber kebenaran):**
```
duration = endsAt - startedAt
elapsed  = min(block.timestamp, endsAt) - startedAt
earned   = deposited * elapsed / duration
claimable = earned - claimed
```
Saat `cancel`: hitung `earned` pada saat itu, refund `deposited - earned` ke subscriber, lalu **set `endsAt = block.timestamp`** supaya `earned` berhenti tumbuh, dan tandai `cancelled`. Agent tetap bisa `claim` bagian yang sudah didapat.

- [ ] **Step 1: Tulis test yang gagal**

`test/FuguSubscription.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
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
        listingId = registry.list(1, address(0xA6E17), FuguRegistry.Category.GRID, 10_00000000, 30 days, "");

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
        vm.expectRevert();
        subs.subscribe{value: needed - 1}(listingId, 1, address(0));

        vm.prank(user);
        uint256 id = subs.subscribe{value: needed}(listingId, 1, address(0));
        assertEq(subs.getSub(id).deposited, needed);
    }

    function test_hasSubscribedGatesReputation() public {
        assertFalse(subs.hasSubscribed(listingId, user));
        _subscribeOnePeriod();
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
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `forge test --match-contract FuguSubscriptionTest`
Expected: gagal kompilasi.

- [ ] **Step 3: Tulis antarmuka**

`src/interfaces/IFuguSubscription.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IFuguSubscription {
    function hasSubscribed(uint256 listingId, address user) external view returns (bool);
}
```

- [ ] **Step 4: Implementasi**

`src/FuguSubscription.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";
import {FuguPriceOracle} from "./FuguPriceOracle.sol";

/// @title FuguSubscription
/// @notice Escrow langganan agent. Agent hanya bisa menarik sebanding waktu yang
///         sudah berjalan, dan user bisa membatalkan kapan saja untuk menarik sisanya.
contract FuguSubscription is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IFuguSubscription
{
    using SafeERC20 for IERC20;

    struct Sub {
        uint256 listingId;
        address subscriber;
        address payToken;
        uint128 deposited;
        uint128 claimed;
        uint64 startedAt;
        uint64 endsAt;
        bool cancelled;
    }

    IFuguRegistry public registry;
    FuguPriceOracle public oracle;
    address public treasury;
    uint16 public protocolFeeBps;

    uint256 private _subCount;
    mapping(uint256 subId => Sub) private _subs;
    mapping(uint256 listingId => mapping(address user => bool)) private _hasSubscribed;

    event Subscribed(
        uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount
    );
    event Claimed(uint256 indexed subId, address indexed to, uint256 amountToOwner, uint256 fee);
    event Cancelled(uint256 indexed subId, uint256 refunded);
    event TreasuryChanged(address treasury);
    event ProtocolFeeChanged(uint16 bps);

    error ListingInactive();
    error ZeroPeriods();
    error WrongNativeAmount(uint256 expected, uint256 got);
    error NotSubscriber();
    error AlreadyCancelled();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address registry_, address oracle_, address treasury_, uint16 feeBps_)
        external
        initializer
    {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        if (feeBps_ > 2000) revert FeeTooHigh();
        registry = IFuguRegistry(registry_);
        oracle = FuguPriceOracle(oracle_);
        treasury = treasury_;
        protocolFeeBps = feeBps_;
    }

    function subscribe(uint256 listingId, uint32 periods, address payToken)
        external
        payable
        nonReentrant
        returns (uint256 subId)
    {
        if (periods == 0) revert ZeroPeriods();
        IFuguRegistry.Listing memory l = registry.getListing(listingId);
        if (!l.active) revert ListingInactive();

        uint256 usdTotal8 = uint256(l.priceUsd8PerPeriod) * periods;
        uint256 amount = oracle.quote(payToken, usdTotal8);

        if (payToken == address(0)) {
            if (msg.value != amount) revert WrongNativeAmount(amount, msg.value);
        } else {
            if (msg.value != 0) revert WrongNativeAmount(0, msg.value);
            IERC20(payToken).safeTransferFrom(msg.sender, address(this), amount);
        }

        subId = ++_subCount;
        uint64 startedAt = uint64(block.timestamp);
        _subs[subId] = Sub({
            listingId: listingId,
            subscriber: msg.sender,
            payToken: payToken,
            deposited: uint128(amount),
            claimed: 0,
            startedAt: startedAt,
            endsAt: startedAt + uint64(uint256(l.periodSeconds) * periods),
            cancelled: false
        });
        _hasSubscribed[listingId][msg.sender] = true;

        emit Subscribed(subId, listingId, msg.sender, payToken, amount);
    }

    function _earned(Sub memory s) internal view returns (uint256) {
        uint256 duration = s.endsAt - s.startedAt;
        if (duration == 0) return s.deposited;
        uint256 nowTs = block.timestamp < s.endsAt ? block.timestamp : s.endsAt;
        uint256 elapsed = nowTs - s.startedAt;
        return (uint256(s.deposited) * elapsed) / duration;
    }

    function claimable(uint256 subId) public view returns (uint256) {
        Sub memory s = _subs[subId];
        return _earned(s) - s.claimed;
    }

    function claim(uint256 subId) external nonReentrant {
        Sub storage s = _subs[subId];
        uint256 amount = _earned(s) - s.claimed;
        if (amount == 0) revert NothingToClaim();
        s.claimed += uint128(amount);

        uint256 fee = (amount * protocolFeeBps) / 10_000;
        uint256 toOwner = amount - fee;
        address listingOwner = registry.getListing(s.listingId).owner;

        _payout(s.payToken, listingOwner, toOwner);
        if (fee > 0) _payout(s.payToken, treasury, fee);

        emit Claimed(subId, listingOwner, toOwner, fee);
    }

    function cancel(uint256 subId) external nonReentrant {
        Sub storage s = _subs[subId];
        if (s.subscriber != msg.sender) revert NotSubscriber();
        if (s.cancelled) revert AlreadyCancelled();

        uint256 earned = _earned(s);
        uint256 refund = uint256(s.deposited) - earned;

        s.cancelled = true;
        // hentikan pertumbuhan bagian agent
        if (block.timestamp < s.endsAt) {
            s.endsAt = uint64(block.timestamp);
            s.deposited = uint128(earned);
        }

        if (refund > 0) _payout(s.payToken, msg.sender, refund);
        emit Cancelled(subId, refund);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function getSub(uint256 subId) external view returns (Sub memory) {
        return _subs[subId];
    }

    function subCount() external view returns (uint256) {
        return _subCount;
    }

    function hasSubscribed(uint256 listingId, address user) external view returns (bool) {
        return _hasSubscribed[listingId][user];
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function setProtocolFeeBps(uint16 bps) external onlyOwner {
        if (bps > 2000) revert FeeTooHigh();
        protocolFeeBps = bps;
        emit ProtocolFeeChanged(bps);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    receive() external payable {}
}
```

> **Catatan implementasi penting.** Pada `cancel`, `deposited` diset ke `earned`
> **setelah** refund dihitung, sehingga `_earned` berikutnya mengembalikan angka yang
> sama dan `claimable` berhenti tumbuh. Test `test_earningsStopGrowingAfterCancel`
> dan `test_agentStillClaimsEarnedAfterCancel` menjaga perilaku ini.

- [ ] **Step 5: Jalankan test sampai hijau**

Run: `forge test --match-contract FuguSubscriptionTest -vv`
Expected: semua PASS.

- [ ] **Step 6: Tambahkan fuzz test invarian dana**

Tambahkan ke `test/FuguSubscription.t.sol`:
```solidity
    /// @notice Kontrak tidak pernah membayar lebih dari yang disetor.
    function testFuzz_neverPaysOutMoreThanDeposited(uint32 periods, uint64 skipTime) public {
        periods = uint32(bound(periods, 1, 12));
        skipTime = uint64(bound(skipTime, 0, 400 days));

        vm.prank(user);
        uint256 id = subs.subscribe(listingId, periods, address(usdt));
        uint256 deposited = subs.getSub(id).deposited;

        vm.warp(block.timestamp + skipTime);

        uint256 creatorBefore = usdt.balanceOf(creator);
        uint256 treasuryBefore = usdt.balanceOf(treasury);
        uint256 userBefore = usdt.balanceOf(user);

        if (subs.claimable(id) > 0) subs.claim(id);
        vm.prank(user);
        subs.cancel(id);
        if (subs.claimable(id) > 0) subs.claim(id);

        uint256 paidOut = (usdt.balanceOf(creator) - creatorBefore) + (usdt.balanceOf(treasury) - treasuryBefore)
            + (usdt.balanceOf(user) - userBefore);

        assertLe(paidOut, deposited);
    }
```

Run: `forge test --match-test testFuzz_neverPaysOutMoreThanDeposited -vv`
Expected: PASS 256 runs.

- [ ] **Step 7: Commit**

```bash
git add contracts/src/FuguSubscription.sol contracts/src/interfaces/IFuguSubscription.sol contracts/test/FuguSubscription.t.sol
git commit -m "feat(contracts): FuguSubscription escrow pro-rata multi-token"
```

---

### Task 5: `FuguReputation`

**Files:**
- Create: `contracts/src/FuguReputation.sol`
- Test: `contracts/test/FuguReputation.t.sol`

**Interfaces:**
- Consumes: `IFuguSubscription.hasSubscribed`
- Produces:
  - `function review(uint256 listingId, uint8 score, string calldata uri) external`
  - `function averageScoreX100(uint256 listingId) external view returns (uint256)`
  - `function reviewCount(uint256 listingId) external view returns (uint256)`
  - Errors: `NotASubscriber()`, `InvalidScore(uint8)`, `AlreadyReviewed()`

- [ ] **Step 1: Tulis test yang gagal**

`test/FuguReputation.t.sol`:
```solidity
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
}
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `forge test --match-contract FuguReputationTest`
Expected: gagal kompilasi.

- [ ] **Step 3: Implementasi**

`src/FuguReputation.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";

/// @title FuguReputation
/// @notice Review yang hanya bisa ditulis wallet yang terbukti pernah berlangganan.
///         Rating anti-sybil — memalsukannya berarti benar-benar harus membayar.
contract FuguReputation is Initializable, UUPSUpgradeable, OwnableUpgradeable {
    struct Agg {
        uint128 sum;
        uint128 count;
    }

    IFuguSubscription public subscriptions;
    mapping(uint256 listingId => Agg) private _agg;
    mapping(uint256 listingId => mapping(address user => bool)) public hasReviewed;

    event Reviewed(uint256 indexed listingId, address indexed reviewer, uint8 score, string uri);

    error NotASubscriber();
    error InvalidScore(uint8 score);
    error AlreadyReviewed();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address subscriptions_) external initializer {
        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        subscriptions = IFuguSubscription(subscriptions_);
    }

    function review(uint256 listingId, uint8 score, string calldata uri) external {
        if (score == 0 || score > 5) revert InvalidScore(score);
        if (!subscriptions.hasSubscribed(listingId, msg.sender)) revert NotASubscriber();
        if (hasReviewed[listingId][msg.sender]) revert AlreadyReviewed();

        hasReviewed[listingId][msg.sender] = true;
        Agg storage a = _agg[listingId];
        a.sum += score;
        a.count += 1;

        emit Reviewed(listingId, msg.sender, score, uri);
    }

    function reviewCount(uint256 listingId) external view returns (uint256) {
        return _agg[listingId].count;
    }

    /// @return Rata-rata skor dikali 100 (mis. 450 berarti 4,50).
    function averageScoreX100(uint256 listingId) external view returns (uint256) {
        Agg memory a = _agg[listingId];
        if (a.count == 0) return 0;
        return (uint256(a.sum) * 100) / a.count;
    }

    function setSubscriptions(address subscriptions_) external onlyOwner {
        subscriptions = IFuguSubscription(subscriptions_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
```

- [ ] **Step 4: Jalankan test sampai hijau**

Run: `forge test --match-contract FuguReputationTest -vv`
Expected: semua PASS.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/FuguReputation.sol contracts/test/FuguReputation.t.sol
git commit -m "feat(contracts): FuguReputation review ber-gate langganan"
```

---

### Task 6: Test upgrade — membuktikan storage aman

**Files:**
- Create: `contracts/test/Upgrade.t.sol`
- Create: `contracts/test/mocks/FuguRegistryV2.sol`

**Interfaces:**
- Consumes: `FuguRegistry`
- Produces: `FuguRegistryV2` — identik dengan V1 plus `uint256 public extraField;` di akhir dan `function version() returns (string)`.

- [ ] **Step 1: Tulis V2 mock**

`test/mocks/FuguRegistryV2.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {FuguRegistry} from "../../src/FuguRegistry.sol";

/// @dev Menambahkan variabel state BARU DI AKHIR — pola append-only.
contract FuguRegistryV2 is FuguRegistry {
    uint256 public extraField;

    function setExtraField(uint256 v) external {
        extraField = v;
    }

    function version() external pure returns (string memory) {
        return "v2";
    }
}
```

- [ ] **Step 2: Tulis test upgrade**

`test/Upgrade.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguRegistryV2} from "./mocks/FuguRegistryV2.sol";

contract UpgradeTest is Test {
    FuguRegistry registry;
    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address stranger = address(0xBAD);

    function setUp() public {
        FuguRegistry impl = new FuguRegistry();
        registry = FuguRegistry(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(FuguRegistry.initialize, (owner))))
        );
    }

    function test_upgradePreservesStorage() public {
        vm.prank(creator);
        uint256 id = registry.list(7, address(0xA6E17), FuguRegistry.Category.YIELD, 3_00000000, 7 days, "ipfs://x");

        FuguRegistryV2 v2impl = new FuguRegistryV2();
        vm.prank(owner);
        registry.upgradeToAndCall(address(v2impl), "");

        FuguRegistryV2 upgraded = FuguRegistryV2(address(registry));
        assertEq(upgraded.version(), "v2");

        FuguRegistry.Listing memory l = upgraded.getListing(id);
        assertEq(l.erc8004AgentId, 7);
        assertEq(l.owner, creator);
        assertEq(l.priceUsd8PerPeriod, 3_00000000);
        assertEq(l.metadataURI, "ipfs://x");
        assertEq(upgraded.listingCount(), 1);
        assertEq(upgraded.countByCategory(FuguRegistry.Category.YIELD), 1);

        // slot baru mulai dari nol dan bisa dipakai
        assertEq(upgraded.extraField(), 0);
        upgraded.setExtraField(99);
        assertEq(upgraded.extraField(), 99);
    }

    function test_nonOwnerCannotUpgrade() public {
        FuguRegistryV2 v2impl = new FuguRegistryV2();
        vm.prank(stranger);
        vm.expectRevert();
        registry.upgradeToAndCall(address(v2impl), "");
    }

    function test_implementationCannotBeInitialized() public {
        FuguRegistry impl = new FuguRegistry();
        vm.expectRevert();
        impl.initialize(owner);
    }
}
```

- [ ] **Step 3: Jalankan test**

Run: `forge test --match-contract UpgradeTest -vv`
Expected: semua PASS.

- [ ] **Step 4: Jalankan seluruh suite**

Run: `forge test`
Expected: semua PASS, tanpa warning kompilasi.

- [ ] **Step 5: Commit**

```bash
git add contracts/test/Upgrade.t.sol contracts/test/mocks/FuguRegistryV2.sol
git commit -m "test(contracts): buktikan storage aman saat upgrade UUPS"
```

---

### Task 7: Script deploy & deploy ke BSC testnet

**Files:**
- Create: `contracts/script/Deploy.s.sol`
- Create: `contracts/script/Upgrade.s.sol`
- Create: `contracts/.env.example`
- Create: `contracts/deployments/bsc-testnet.json`

**Interfaces:**
- Consumes: keempat kontrak
- Produces: alamat proxy yang tercatat di `deployments/bsc-testnet.json`

- [ ] **Step 1: Tulis `.env.example`**

`contracts/.env.example`:
```bash
# Wallet BARU khusus testnet. JANGAN pakai key yang pernah menyentuh mainnet.
DEPLOYER_PRIVATE_KEY=0x
BSC_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545
BSCSCAN_API_KEY=
TREASURY_ADDRESS=
PROTOCOL_FEE_BPS=500
```

- [ ] **Step 2: Tulis script deploy**

`script/Deploy.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {FuguPriceOracle} from "../src/FuguPriceOracle.sol";
import {FuguRegistry} from "../src/FuguRegistry.sol";
import {FuguSubscription} from "../src/FuguSubscription.sol";
import {FuguReputation} from "../src/FuguReputation.sol";

contract Deploy is Script {
    // Alamat BSC testnet — terverifikasi live 2026-09-08
    address constant FEED_BNB_USD = 0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526;
    address constant FEED_USDT_USD = 0xEca2605f0BCF2BA5966372C99837b1F182d3D620;
    address constant FEED_BUSD_USD = 0x9331b55D9830EF609A2aBCfAc0FBCE050A52fdEa;
    address constant TOKEN_USDT = 0x337610d27c682E347C9cD60BD4b3b107C9d34dDd;
    address constant TOKEN_BUSD = 0xeD24FC36d5Ee211Ea25A80239Fb8C4Cfd80f12Ee;
    address constant TOKEN_U = 0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
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

        // Konfigurasi token pembayaran
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
                maxStaleness: 93_600, // 26 jam — heartbeat stablecoin testnet lambat
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
```

- [ ] **Step 3: Simulasi deploy tanpa broadcast**

```bash
cp .env.example .env    # isi DEPLOYER_PRIVATE_KEY dan TREASURY_ADDRESS
source .env
forge script script/Deploy.s.sol:Deploy --rpc-url "$BSC_TESTNET_RPC_URL"
```
Expected: simulasi sukses, keempat alamat tercetak. Belum ada transaksi terkirim.

- [ ] **Step 4: Tulis script upgrade**

`script/Upgrade.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @notice Upgrade satu proxy ke implementasi baru.
/// @dev Jalankan dengan: PROXY=0x.. NEW_IMPL=0x.. forge script script/Upgrade.s.sol:Upgrade --broadcast
contract Upgrade is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proxy = vm.envAddress("PROXY");
        address newImpl = vm.envAddress("NEW_IMPL");

        vm.startBroadcast(pk);
        UUPSUpgradeable(proxy).upgradeToAndCall(newImpl, "");
        vm.stopBroadcast();

        console.log("upgraded", proxy, "->", newImpl);
    }
}
```

- [ ] **Step 5: Deploy sungguhan ke testnet**

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$BSC_TESTNET_RPC_URL" \
  --broadcast \
  --verify \
  --etherscan-api-key "$BSCSCAN_API_KEY" \
  -vvv
```
Expected: 8 kontrak ter-deploy (4 implementasi + 4 proxy), verifikasi sukses di testnet.bscscan.com.

Jika verifikasi gagal tapi deploy sukses, jangan ulangi deploy — verifikasi terpisah:
```bash
forge verify-contract <IMPL_ADDRESS> src/FuguRegistry.sol:FuguRegistry \
  --chain 97 --etherscan-api-key "$BSCSCAN_API_KEY"
```

- [ ] **Step 6: Catat alamat**

`contracts/deployments/bsc-testnet.json` — isi dari output console:
```json
{
  "chainId": 97,
  "deployedAt": "2026-09-08",
  "FuguPriceOracle": "0x...",
  "FuguRegistry": "0x...",
  "FuguSubscription": "0x...",
  "FuguReputation": "0x..."
}
```

- [ ] **Step 7: Verifikasi on-chain bahwa oracle hidup**

```bash
source .env
cast call --rpc-url "$BSC_TESTNET_RPC_URL" <ORACLE_PROXY> \
  "quote(address,uint256)(uint256)" 0x0000000000000000000000000000000000000000 100000000
```
Expected: mengembalikan jumlah wei tBNB senilai $1 (sekitar `1.3e15` pada harga ~$754).

- [ ] **Step 8: Commit**

```bash
git add contracts/script contracts/.env.example contracts/deployments
git commit -m "feat(contracts): script deploy + deploy ke BSC testnet"
```

---

## Definition of Done

- [ ] `forge test` hijau seluruhnya, termasuk fuzz 256 runs
- [ ] Empat proxy ter-deploy di BSC testnet dan terverifikasi di testnet.bscscan.com
- [ ] `deployments/bsc-testnet.json` terisi
- [ ] `cast call quote(...)` mengembalikan angka masuk akal terhadap harga BNB nyata
- [ ] Tidak ada `__gap`, tidak ada `require` string, tidak ada pragma selain `^0.8.30`
