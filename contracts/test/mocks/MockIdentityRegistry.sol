// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @dev The slice of the ERC-8004 IdentityRegistry ("AgentIdentity" 2.0.0 at
///      `0x8004A818BFB912233c491871b3d84c89A494BD9e` on BSC testnet) that `FuguRegistry`
///      and the identity scripts touch: ERC-721 ownership, sequential ids starting at 0,
///      `register(agentURI)`, `setAgentURI`, `tokenURI`.
///
///      Minted with `_mint`, not `_safeMint`, matching the live implementation: its
///      bytecode contains no `onERC721Received` selector, so a contract caller (a test
///      contract, a script harness) receives the token without implementing a receiver.
///      `ownerOf` of an id never minted reverts with `ERC721NonexistentToken`, exactly as
///      `ownerOf(8004)` does on the live registry today.
contract MockIdentityRegistry is ERC721 {
    uint256 private _nextId;
    mapping(uint256 agentId => string) private _uris;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    error NotAgentOwner(uint256 agentId, address caller);

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = _nextId++;
        _mint(msg.sender, agentId);
        _uris[agentId] = agentURI;
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotAgentOwner(agentId, msg.sender);
        _uris[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }

    /// @dev Test helper: jump the counter so a test can stand where the live registry
    ///      stands (ids in the thousands) or mint an id that collides with a placeholder.
    function skipTo(uint256 nextId) external {
        _nextId = nextId;
    }
}
