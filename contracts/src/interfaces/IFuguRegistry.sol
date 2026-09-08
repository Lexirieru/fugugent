// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// NOTE: `Category` dan `Listing` didefinisikan langsung di kontrak `FuguRegistry`
// (bukan di sini), lalu dipakai ulang oleh interface ini via import.
//
// Alasan: Solidity tidak mengekspos tipe (enum/struct) yang hanya diwarisi
// lewat inheritance melalui nama kontrak turunan — `FuguRegistry.Category`
// hanya bisa di-resolve dari luar (mis. oleh test) kalau `Category` memang
// dideklarasikan langsung di badan kontrak `FuguRegistry`, bukan sekadar
// diwarisi dari interface ini. Import melingkar (FuguRegistry <-> IFuguRegistry)
// ini legal di Solidity dan sudah diverifikasi compile dengan solc 0.8.30.
import {FuguRegistry} from "../FuguRegistry.sol";

interface IFuguRegistry {
    function getListing(uint256 listingId) external view returns (FuguRegistry.Listing memory);
    function listingCount() external view returns (uint256);
}
