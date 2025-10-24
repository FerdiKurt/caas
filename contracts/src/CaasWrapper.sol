// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CaasWrapper {
    address public owner;
    mapping(address => bool) public allowedProtocol;

    event TxForOffset(
        address indexed protocol,
        bytes32 indexed txHash,
        uint256 gasUsed,
        uint256 chainId,
        bytes meta
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setProtocol(address p, bool ok) external onlyOwner {
        allowedProtocol[p] = ok;
    }

    function emitTxForOffset(
        bytes32 txHash,
        uint256 gasUsed,
        bytes calldata meta
    ) external {
        require(allowedProtocol[msg.sender], "not allowed");
        emit TxForOffset(msg.sender, txHash, gasUsed, block.chainid, meta);
    }
}
