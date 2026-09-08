// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {Category, Listing} from "./types/FuguTypes.sol";

/// @title FuguRegistry
/// @notice Katalog agent yang layak ditampilkan di marketplace, menjembatani
///         identitas ERC-8004 yang mentah dengan listing yang punya harga dan kategori.
///
/// @dev ## BATAS KEPERCAYAAN — kepemilikan ERC-8004 BELUM diverifikasi
///
///      `list()` bersifat permissionless dan kontrak ini **tidak memanggil registry
///      ERC-8004 eksternal** untuk membuktikan bahwa `msg.sender` benar-benar memiliki
///      `erc8004AgentId` yang ia daftarkan. Yang dijamin di sini hanyalah **keunikan
///      first-come-first-served**: satu `erc8004AgentId` hanya bisa dipetakan ke satu
///      listing (lihat `listingByAgentId`), sehingga tidak ada dua listing yang saling
///      berebut identitas yang sama.
///
///      Artinya penyerang yang bergerak lebih dulu masih bisa "menyerobot" ID agent
///      milik orang lain dan menerima pembayaran atas nama identitas itu. Untuk
///      hackathon/testnet ini diterima secara sadar; **verifikasi kepemilikan token
///      ERC-8004 di registry eksternal WAJIB ditambahkan sebelum kontrak ini menyentuh
///      dana sungguhan (mainnet).** Mitigasi sementara: flag `curated` yang hanya bisa
///      diset kurator terpercaya, dan UI sebaiknya hanya menonjolkan listing curated.
contract FuguRegistry is Initializable, UUPSUpgradeable, OwnableUpgradeable, IFuguRegistry {
    uint256 private _listingCount;
    mapping(uint256 listingId => Listing) private _listings;
    mapping(Category => uint256) private _countByCategory;
    mapping(address => bool) public isCurator;

    // --- variabel state baru (append-only, ditambahkan di AKHIR) ---

    /// @notice Pemetaan identitas ERC-8004 -> listing yang sudah mengklaimnya.
    /// @dev 0 berarti belum pernah diklaim (listing id selalu dimulai dari 1).
    ///      Menjamin keunikan di dalam registry ini saja — bukan bukti kepemilikan,
    ///      lihat NatSpec kontrak.
    mapping(uint256 erc8004AgentId => uint256 listingId) public listingByAgentId;

    event Listed(uint256 indexed listingId, address indexed owner, Category indexed category, uint256 erc8004AgentId);
    event ListingUpdated(uint256 indexed listingId, uint128 priceUsd8PerPeriod, uint32 periodSeconds, string metadataURI);
    event ActiveChanged(uint256 indexed listingId, bool active);
    event CuratedChanged(uint256 indexed listingId, bool curated);
    event CuratorChanged(address indexed curator, bool allowed);

    error NotListingOwner(uint256 listingId);
    error ListingNotFound(uint256 listingId);
    error InvalidPeriod();
    error NotCurator();
    error AgentAlreadyListed(uint256 erc8004AgentId, uint256 existingListingId);
    error CannotCurateOwnListing();
    error InvalidPrice();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_) external initializer {
        __Ownable_init(owner_);
    }

    modifier onlyListingOwner(uint256 listingId) {
        if (_listings[listingId].owner == address(0)) revert ListingNotFound(listingId);
        if (_listings[listingId].owner != msg.sender) revert NotListingOwner(listingId);
        _;
    }

    /// @notice Daftarkan agent baru ke katalog.
    /// @dev Satu `erc8004AgentId` hanya boleh dipakai satu listing; percobaan kedua
    ///      revert dengan `AgentAlreadyListed`. Ini mencegah dua listing bersaing atas
    ///      identitas yang sama, tapi TIDAK membuktikan `msg.sender` memiliki identitas
    ///      itu — lihat NatSpec kontrak.
    function list(
        uint256 erc8004AgentId,
        address agentWallet,
        Category category,
        uint128 priceUsd8PerPeriod,
        uint32 periodSeconds,
        string calldata metadataURI
    ) external returns (uint256 listingId) {
        if (periodSeconds == 0) revert InvalidPeriod();
        if (priceUsd8PerPeriod == 0) revert InvalidPrice();

        uint256 existing = listingByAgentId[erc8004AgentId];
        if (existing != 0) revert AgentAlreadyListed(erc8004AgentId, existing);

        listingId = ++_listingCount;
        listingByAgentId[erc8004AgentId] = listingId;
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
        if (priceUsd8PerPeriod == 0) revert InvalidPrice();
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

    /// @notice Tandai/lepas tanda kurasi pada sebuah listing.
    /// @dev Kurator tidak boleh mengkurasi listing miliknya sendiri (`CannotCurateOwnListing`),
    ///      supaya alamat yang kebetulan berstatus kurator tidak bisa memberi stempel
    ///      kepercayaan pada listing-nya sendiri.
    function setCurated(uint256 listingId, bool curated) external {
        if (!isCurator[msg.sender]) revert NotCurator();
        address listingOwner = _listings[listingId].owner;
        if (listingOwner == address(0)) revert ListingNotFound(listingId);
        if (msg.sender == listingOwner) revert CannotCurateOwnListing();
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

    /// @notice Total listing yang PERNAH dibuat pada kategori ini.
    /// @dev Angka ini tidak berkurang saat sebuah listing dinonaktifkan lewat
    ///      `setActive(id, false)` — ini adalah hitungan kumulatif "pernah dibuat",
    ///      bukan hitungan listing yang sedang aktif. Jangan ditafsirkan sebagai
    ///      jumlah listing aktif di frontend.
    function countByCategory(Category category) external view returns (uint256) {
        return _countByCategory[category];
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
