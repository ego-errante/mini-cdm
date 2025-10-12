// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    euint32,
    externalEuint32,
    externalEuint8,
    externalEuint64,
    euint64
} from "@fhevm/solidity/lib/FHE.sol";

interface IDatasetRegistry {
    // ---- views ----
    function getDataset(uint256 datasetId)
        external
        view
        returns (bytes32 merkleRoot, uint256 numColumns, uint256 rowCount, address owner, bool exists, euint32 kAnonymity, uint32 cooldownSec);

    function doesDatasetExist(uint256 datasetId) external view returns (bool);

    function isDatasetOwner(uint256 datasetId, address account) external view returns (bool);

    function isRowSchemaValid(uint256 datasetId, uint256 fieldCount) external view returns (bool);

    // ---- administration ----
    function setJobManager(address jobManager) external;

    function getJobManager() external view returns (address);

    // ---- lifecycle ----
    function commitDataset(uint256 rowCount, bytes32 merkleRoot, uint256 numColumns, externalEuint32 kAnonymity, bytes calldata inputProof, uint32 cooldownSec) external returns (uint256 datasetId);

    function deleteDataset(uint256 datasetId) external;

    // ---- events ----
    event DatasetCommitted(
        uint256 indexed datasetId,
        bytes32 merkleRoot,
        uint256 numColumns,
        uint256 rowCount,
        address indexed owner,
        euint32 kAnonymity,
        uint32 cooldownSec
    );

    event DatasetDeleted(uint256 indexed datasetId, address indexed owner);

    event JobManagerSet(address indexed jobManager);

    // ---- errors ----
    error DatasetNotFound();
    error NotDatasetOwner();
    error InvalidMerkleRoot();
    error InvalidNumColumns();
    error InvalidRowCount();
    error InvalidRowSchema();
    error JobManagerNotSet();
    error InvalidJobManagerAddress();
}
