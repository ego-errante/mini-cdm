// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDatasetRegistry {
    // ---- views ----
    function getDataset(uint256 datasetId) external view returns (bytes32 merkleRoot, bytes32 schemaHash, bool exists);

    function isDatasetOwner(uint256 datasetId, address account) external view returns (bool);

    // ---- lifecycle ----
    function commitDataset(uint256 datasetId, bytes32 merkleRoot, bytes32 schemaHash) external;

    function deleteDataset(uint256 datasetId) external;

    // ---- events ----
    event DatasetCommitted(uint256 indexed datasetId, bytes32 merkleRoot, bytes32 schemaHash, address indexed owner);

    event DatasetDeleted(uint256 indexed datasetId, address indexed owner);

    // ---- errors ----
    error DatasetNotFound();
    error NotDatasetOwner();
    error InvalidMerkleRoot();
    error InvalidSchemaHash();
}
