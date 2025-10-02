// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDatasetRegistry.sol";

contract DatasetRegistry is IDatasetRegistry {
    // ---- state ----
    mapping(uint256 => Dataset) private _datasets;

    struct Dataset {
        bytes32 merkleRoot;
        bytes32 schemaHash;
        uint256 rowCount;
        address owner;
        bool exists;
    }

    // ---- views ----
    function getDataset(uint256 datasetId)
        external
        view
        returns (bytes32 merkleRoot, bytes32 schemaHash, uint256 rowCount, address owner, bool exists) {
        Dataset memory dataset = _datasets[datasetId];
        return (dataset.merkleRoot, dataset.schemaHash, dataset.rowCount, dataset.owner, dataset.exists);
    }

    function doesDatasetExist(uint256 datasetId) external view returns (bool) {
        return _datasets[datasetId].exists;
    }

    function isDatasetOwner(uint256 datasetId, address account) external view returns (bool) {
        return _datasets[datasetId].owner == account;
    }

    function isRowSchemaValid(uint256 datasetId, uint256 fieldCount) external view returns (bool) {
        Dataset storage dataset = _datasets[datasetId];
        if (!dataset.exists) {
            return false;
        }
        bytes32 actualSchemaHash = keccak256(abi.encodePacked(fieldCount));
        return actualSchemaHash == dataset.schemaHash;
    }

    // ---- lifecycle ----
    function commitDataset(uint256 datasetId, uint256 rowCount, bytes32 merkleRoot, bytes32 schemaHash) external {
        // Validate inputs
        if (rowCount == 0) {
            revert InvalidRowCount();
        }
        if (merkleRoot == bytes32(0)) {
            revert InvalidMerkleRoot();
        }
        if (schemaHash == bytes32(0)) {
            revert InvalidSchemaHash();
        }

        Dataset storage dataset = _datasets[datasetId];

        // If dataset doesn't exist, create it with caller as owner
        if (!dataset.exists) {
            dataset.owner = msg.sender;
            dataset.exists = true;
        } else {
            // If it exists, only owner can update
            if (dataset.owner != msg.sender) {
                revert NotDatasetOwner();
            }
        }

        // Update the dataset
        dataset.merkleRoot = merkleRoot;
        dataset.schemaHash = schemaHash;
        dataset.rowCount = rowCount;

        emit DatasetCommitted(datasetId, merkleRoot, schemaHash, rowCount, msg.sender);
    }

    function deleteDataset(uint256 datasetId) external {
        Dataset storage dataset = _datasets[datasetId];

        // Check if dataset exists
        if (!dataset.exists) {
            revert DatasetNotFound();
        }

        // Check if caller is owner
        if (dataset.owner != msg.sender) {
            revert NotDatasetOwner();
        }

        // Delete the dataset
        delete _datasets[datasetId];

        emit DatasetDeleted(datasetId, msg.sender);
    }
}
