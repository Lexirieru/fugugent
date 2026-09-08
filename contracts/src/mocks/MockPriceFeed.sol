// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @title MockPriceFeed
/// @notice Feed harga Chainlink-kompatibel untuk pengujian di testnet.
/// @dev Kontrak uji, bukan bagian produk: tidak upgradeable, tidak ada `__gap`.
contract MockPriceFeed is IAggregatorV3, Ownable {
    uint8 private immutable _decimals;
    int256 private _answer;
    uint256 private _updatedAt;

    constructor(uint8 decimals_, int256 initialAnswer) Ownable(msg.sender) {
        _decimals = decimals_;
        _answer = initialAnswer;
        _updatedAt = block.timestamp;
    }

    /// @notice Ubah harga yang dilaporkan feed; memperbarui `updatedAt` ke waktu saat ini.
    function setAnswer(int256 newAnswer) external onlyOwner {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "mock";
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (1, _answer, _updatedAt, _updatedAt, 1);
    }
}
