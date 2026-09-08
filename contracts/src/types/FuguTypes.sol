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
