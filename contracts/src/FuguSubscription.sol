// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
