// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// Shared types for the agent listing catalog, declared at file level (not inside any
// contract or interface) so that both `IFuguRegistry` and `FuguRegistry` can import
// them without creating an interface -> implementation dependency.

/// @notice The marketplace catalog categories.
///
/// @dev ## APPEND ONLY. NEVER reorder, never insert, never delete.
///
///      A `Category` is stored inside `Listing` as its numeric index, and that number
///      is what lives in the storage of the `FuguRegistry` proxy already deployed on
///      BSC testnet (`0xb2f36070E6eae3353E8e755172B477DF213ae248`), together with the
///      keys of the `_countByCategory` mapping. An upgrade only replaces the code, it
///      never rewrites that storage.
///
///      So inserting a value in the middle, or reordering these lines, silently changes
///      what every listing that is already registered MEANS: a listing stored as 3 was
///      registered as HEALTH_FACTOR and would start reading back as whatever name now
///      sits at index 3. Nothing reverts, nothing warns. The catalog just starts lying,
///      and `_countByCategory` keeps counting under the old keys.
///
///      New capabilities therefore go at the END, after `HEALTH_FACTOR`.
///      `test/CategoryUpgradeSafety.t.sol` deploys the pre-expansion implementation,
///      registers one listing per old category, upgrades the proxy to this version, and
///      reads every listing back. Shift a value here and that test turns red.
enum Category {
    REBALANCING,
    GRID,
    YIELD,
    HEALTH_FACTOR,
    // --- appended 2026-09-09, five new capabilities. Old indices 0-3 are frozen. ---
    HIRING,
    COMMERCE,
    AUTONOMOUS,
    STREAMING,
    TREASURY
}

/// @notice One agent catalog entry.
/// @dev The roles of `owner` and `agentWallet` are deliberately separate and
///      **must never be swapped** — see the NatSpec on each field.
struct Listing {
    /// @notice The ERC-8004 identity ID this listing claims.
    /// @dev WARNING: `FuguRegistry` only guarantees this ID is unique within
    ///      its own registry; it does NOT verify against the external ERC-8004
    ///      registry that `owner` actually owns that ID.
    uint256 erc8004AgentId;
    /// @notice The listing owner — **this is who gets paid**.
    /// @dev Every subscription payout (`FuguSubscription.claim`) goes to this
    ///      address, not to `agentWallet`. `owner` is also the only address
    ///      allowed to call `updateListing` and `setActive`.
    address owner;
    /// @notice The agent's operational address (the Altana wallet that executes transactions).
    /// @dev **NEVER receives any payment.** This field is pure metadata: the UI
    ///      uses it to link the agent's on-chain activity (rebalancing txs, grid
    ///      orders, and so on) back to its listing. No payment logic in
    ///      `FuguSubscription` reads it. Do not treat it as a payee.
    address agentWallet;
    Category category;
    uint128 priceUsd8PerPeriod;
    uint32 periodSeconds;
    bool active;
    bool curated;
    string metadataURI;
}
