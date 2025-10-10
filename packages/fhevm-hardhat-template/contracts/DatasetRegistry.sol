// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IDatasetRegistry.sol";

contract DatasetRegistry is IDatasetRegistry {
    // ---- state ----
    mapping(uint256 => Dataset) private _datasets;

    struct Dataset {
        bytes32 merkleRoot;
        uint256 numColumns;
        uint256 rowCount;
        address owner;
        bool exists;
        uint32 kAnonymity;
        uint32 cooldownSec;
    }

    // ---- views ----
    function getDataset(uint256 datasetId)
        external
        view
        returns (bytes32 merkleRoot, uint256 numColumns, uint256 rowCount, address owner, bool exists, uint32 kAnonymity, uint32 cooldownSec) {
        Dataset memory dataset = _datasets[datasetId];
        return (dataset.merkleRoot, dataset.numColumns, dataset.rowCount, dataset.owner, dataset.exists, dataset.kAnonymity, dataset.cooldownSec);
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
        return fieldCount == dataset.numColumns;
    }

    // ---- lifecycle ----
    function commitDataset(uint256 datasetId, uint256 rowCount, bytes32 merkleRoot, uint256 numColumns, uint32 kAnonymity, uint32 cooldownSec) external {
        // Validate inputs
        if (rowCount == 0) {
            revert InvalidRowCount();
        }
        if (merkleRoot == bytes32(0)) {
            revert InvalidMerkleRoot();
        }
        if (numColumns == 0) {
            revert InvalidNumColumns();
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
        dataset.numColumns = numColumns;
        dataset.rowCount = rowCount;
        dataset.kAnonymity = kAnonymity;
        dataset.cooldownSec = cooldownSec;

        emit DatasetCommitted(datasetId, merkleRoot, numColumns, rowCount, msg.sender, kAnonymity, cooldownSec);
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
