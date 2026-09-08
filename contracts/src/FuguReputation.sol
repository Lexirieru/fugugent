// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";

/// @title FuguReputation
/// @notice Review yang hanya bisa ditulis wallet yang sudah membayar agent dalam jumlah
///         berarti.
/// @dev **Apa yang gate ini benar-benar jamin — dan apa yang tidak.**
///      Hak review terbuka setelah agent benar-benar MENERIMA setidaknya sekian persen
///      dari harga satu periode penuh (default 50%, lihat
///      `FuguSubscription.minPaidBpsOfPeriod`). Ini ambang ekonomi, bukan bukti
///      identitas: sybil tetap mungkin bagi siapa pun yang bersedia membayar setengah
///      periode untuk tiap wallet, dan uangnya jatuh ke agent yang direview.
///      **Batas penting yang harus diketahui pembaca rating:** penyebut ambang adalah
///      harga satu periode listing itu sendiri, yang ditentukan pemilik listing sebelum
///      terkunci pada langganan pertama tiap wallet. Pemilik listing yang ingin
///      mengembang-kan rating listing MILIKNYA SENDIRI dapat menurunkan harga ke nilai
///      debu, membiarkan wallet-wallet miliknya berlangganan, lalu menaikkan harga lagi —
///      biaya bersihnya hanya fee protokol dan gas. Gate ini karena itu mahal bagi pihak
///      luar yang menyerang rating agent ORANG LAIN, tetapi tidak mencegah pemilik
///      memoles rating sendiri. Kurasi dan verifikasi kepemilikan ERC-8004 adalah lapisan
///      yang menutup celah itu, dan keduanya belum lengkap.
/// @dev Trust boundary: The anti-sybil gate applies to end users. The contract owner
///      is a trusted entity who can bypass the gate by calling setSubscriptions() to
///      point to a malicious subscription contract, or by upgrading the contract logic
///      via UUPS. Ownership will be transferred to a multisig after hackathon period.
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
    error ZeroAddress();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address subscriptions_) external initializer {
        __Ownable_init(owner_);
        if (subscriptions_ == address(0)) revert ZeroAddress();
        subscriptions = IFuguSubscription(subscriptions_);
    }

    /// @notice Tulis review untuk agent (listing).
    /// @param listingId ID agent yang direview.
    /// @param score Skor 1-5.
    /// @param uri IPFS URI atau metadata URI.
    /// @dev Hanya wallet yang sudah membayar agent dalam jumlah berarti
    ///      (`hasSubscribed == true`) yang bisa menulis review: agent harus benar-benar
    ///      sudah menerima setidaknya `minPaidBpsOfPeriod` bps — default 50% — dari harga
    ///      satu periode penuh. Berlangganan lalu langsung batal tidak memberi hak, dan
    ///      begitu pula membayar "debu" (subscribe, maju satu detik, claim, cancel).
    ///      Satu wallet hanya bisa review sekali per agent.
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
        if (subscriptions_ == address(0)) revert ZeroAddress();
        subscriptions = IFuguSubscription(subscriptions_);
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
