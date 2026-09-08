// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IFuguRegistry} from "./interfaces/IFuguRegistry.sol";
import {IFuguSubscription} from "./interfaces/IFuguSubscription.sol";
import {FuguPriceOracle} from "./FuguPriceOracle.sol";
import {Listing} from "./types/FuguTypes.sol";

/// @title FuguSubscription
/// @notice Escrow langganan agent. Agent hanya bisa menarik sebanding waktu yang
///         sudah berjalan, dan user bisa membatalkan kapan saja untuk menarik sisanya.
contract FuguSubscription is
    Initializable,
    UUPSUpgradeable,
    OwnableUpgradeable,
    ReentrancyGuard,
    IFuguSubscription
{
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    struct Sub {
        uint256 listingId;
        address subscriber;
        address payToken;
        uint128 deposited;
        uint128 claimed;
        uint64 startedAt;
        uint64 endsAt;
        bool cancelled;
        // @dev Ditambahkan di akhir struct (append-only) — snapshot fee saat subscribe,
        //      supaya kenaikan `protocolFeeBps` di kemudian hari tidak berlaku surut.
        uint16 feeBps;
    }

    IFuguRegistry public registry;
    FuguPriceOracle public oracle;
    address public treasury;
    uint16 public protocolFeeBps;

    uint256 private _subCount;
    mapping(uint256 subId => Sub) private _subs;
    /// @dev listingId => subscriber => total yang sudah benar-benar dibayarkan ke agent
    ///      (lewat `claim`). Sumber kebenaran untuk `hasSubscribed`: subscribe+cancel di
    ///      blok yang sama tidak boleh membuka hak review — hanya pembayaran nyata yang
    ///      membukanya.
    mapping(uint256 listingId => mapping(address user => uint256)) private _paidToAgent;
    /// @dev Payout native yang gagal terkirim (push) menumpuk di sini untuk ditarik (pull)
    ///      lewat `withdrawPending`, supaya listing owner berupa kontrak yang menolak ETH
    ///      tidak mengunci bagian agent selamanya.
    mapping(address => uint256) public pendingWithdrawals;

    event Subscribed(
        uint256 indexed subId, uint256 indexed listingId, address indexed subscriber, address payToken, uint256 amount
    );
    event Claimed(uint256 indexed subId, address indexed to, uint256 amountToOwner, uint256 fee);
    event Cancelled(uint256 indexed subId, uint256 refunded);
    event TreasuryChanged(address treasury);
    event ProtocolFeeChanged(uint16 bps);
    event PayoutDeferred(address indexed to, uint256 amount);

    error ListingInactive();
    error ZeroPeriods();
    error WrongNativeAmount(uint256 expected, uint256 got);
    error NotSubscriber();
    error AlreadyCancelled();
    error NothingToClaim();
    error TransferFailed();
    error FeeTooHigh();
    error NothingToWithdraw();
    error ZeroAmountReceived();

    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address registry_, address oracle_, address treasury_, uint16 feeBps_)
        external
        initializer
    {
        __Ownable_init(owner_);
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
        Listing memory l = registry.getListing(listingId);
        if (!l.active) revert ListingInactive();

        uint256 usdTotal8 = uint256(l.priceUsd8PerPeriod) * periods;
        uint256 amount = oracle.quote(payToken, usdTotal8);

        if (payToken == address(0)) {
            if (msg.value != amount) revert WrongNativeAmount(amount, msg.value);
        } else {
            if (msg.value != 0) revert WrongNativeAmount(0, msg.value);
            // Ukur delta saldo nyata alih-alih mempercayai `amount` hasil quote, supaya
            // token fee-on-transfer / rebasing tidak membuat `deposited` mengklaim lebih
            // dari yang benar-benar diterima kontrak.
            uint256 balBefore = IERC20(payToken).balanceOf(address(this));
            IERC20(payToken).safeTransferFrom(msg.sender, address(this), amount);
            uint256 received = IERC20(payToken).balanceOf(address(this)) - balBefore;
            if (received == 0) revert ZeroAmountReceived();
            amount = received;
        }

        subId = ++_subCount;
        uint64 startedAt = uint64(block.timestamp);
        _subs[subId] = Sub({
            listingId: listingId,
            subscriber: msg.sender,
            payToken: payToken,
            deposited: amount.toUint128(),
            claimed: 0,
            startedAt: startedAt,
            endsAt: startedAt + uint64(uint256(l.periodSeconds) * periods),
            cancelled: false,
            feeBps: protocolFeeBps
        });

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
        s.claimed += amount.toUint128();
        // Sumber kebenaran hak review: dibayar dulu, baru boleh dinilai.
        _paidToAgent[s.listingId][s.subscriber] += amount;

        // Fee dipakai dari snapshot saat subscribe, bukan `protocolFeeBps` saat ini,
        // supaya kenaikan fee tidak berlaku surut ke penghasilan yang sudah accrued.
        uint256 fee = (amount * s.feeBps) / 10_000;
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
            s.deposited = earned.toUint128();
        }

        if (refund > 0) _payout(s.payToken, msg.sender, refund);
        emit Cancelled(subId, refund);
    }

    function _payout(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (token == address(0)) {
            // Push payment: bila penerima menolak ETH (mis. listing owner adalah kontrak
            // tanpa `receive`/`payable fallback`, atau sengaja menolak), JANGAN revert
            // seluruh `claim` — kredit ke `pendingWithdrawals` supaya bagian agent tidak
            // terkunci selamanya dan bisa ditarik nanti lewat `withdrawPending`.
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) {
                pendingWithdrawals[to] += amount;
                emit PayoutDeferred(to, amount);
            }
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    /// @notice Tarik native coin yang gagal terkirim otomatis lewat `_payout`.
    function withdrawPending() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function getSub(uint256 subId) external view returns (Sub memory) {
        return _subs[subId];
    }

    function subCount() external view returns (uint256) {
        return _subCount;
    }

    /// @notice True hanya bila agent benar-benar sudah dibayar untuk `user` pada `listingId`
    ///         (lewat `claim`) — subscribe lalu cancel di blok yang sama TIDAK membuka hak
    ///         review, karena tidak ada pembayaran nyata yang terjadi.
    function hasSubscribed(uint256 listingId, address user) external view returns (bool) {
        return _paidToAgent[listingId][user] > 0;
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
