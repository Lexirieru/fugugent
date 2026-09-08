// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Tipe bersama untuk katalog listing agent, dideklarasikan di level
///         file (bukan di dalam kontrak/interface mana pun) supaya bisa
///         di-import baik oleh `IFuguRegistry` maupun `FuguRegistry` tanpa
///         menciptakan ketergantungan interface -> implementasi.
enum Category {
    REBALANCING,
    GRID,
    YIELD,
    HEALTH_FACTOR
}

/// @notice Satu entri katalog agent.
/// @dev Pembagian peran antara `owner` dan `agentWallet` sengaja dipisah dan
///      **tidak boleh tertukar** — lihat NatSpec masing-masing field.
struct Listing {
    /// @notice ID identitas ERC-8004 yang diklaim oleh listing ini.
    /// @dev PERINGATAN: `FuguRegistry` hanya menjamin ID ini unik di dalam
    ///      registry-nya sendiri; ia TIDAK memverifikasi ke registry ERC-8004
    ///      eksternal bahwa `owner` benar-benar memiliki ID tersebut.
    uint256 erc8004AgentId;
    /// @notice Pemilik listing — **inilah penerima uang**.
    /// @dev Seluruh payout langganan (`FuguSubscription.claim`) dikirim ke
    ///      alamat ini, bukan ke `agentWallet`. `owner` juga satu-satunya alamat
    ///      yang boleh memanggil `updateListing` dan `setActive`.
    address owner;
    /// @notice Alamat operasional agent (wallet Altana yang mengeksekusi transaksi).
    /// @dev **TIDAK pernah menerima pembayaran apa pun.** Field ini murni metadata:
    ///      dipakai UI untuk menautkan aktivitas on-chain agent (tx rebalancing,
    ///      grid order, dsb.) ke listing-nya. Tidak dibaca oleh logika pembayaran
    ///      mana pun di `FuguSubscription`. Jangan tafsirkan sebagai payee.
    address agentWallet;
    Category category;
    uint128 priceUsd8PerPeriod;
    uint32 periodSeconds;
    bool active;
    bool curated;
    string metadataURI;
}
