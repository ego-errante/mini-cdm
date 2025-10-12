// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {
    FHE,
    euint32,
    externalEuint32
} from "@fhevm/solidity/lib/FHE.sol";
import "./IDatasetRegistry.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract DatasetRegistry is IDatasetRegistry, SepoliaConfig, Ownable {
    constructor() Ownable(msg.sender) {}

    // ---- state ----
    uint256 private _nextDatasetId = 1;
    mapping(uint256 => Dataset) private _datasets;
    address private _jobManager;

    struct Dataset {
        bytes32 merkleRoot;
        uint256 numColumns;
        uint256 rowCount;
        address owner;
        bool exists;
        euint32 kAnonymity;
        uint32 cooldownSec;
    }

    // ---- views ----
    function getDataset(uint256 datasetId)
        external
        view
        returns (
            bytes32 merkleRoot,
            uint256 numColumns,
            uint256 rowCount,
            address owner,
            bool exists,
            euint32 kAnonymity,
            uint32 cooldownSec
        ) {
        Dataset memory dataset = _datasets[datasetId];
        return (
            dataset.merkleRoot,
            dataset.numColumns,
            dataset.rowCount,
            dataset.owner,
            dataset.exists,
            dataset.kAnonymity,
            dataset.cooldownSec
        );
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

    // ---- administration ----
    function setJobManager(address jobManager) external onlyOwner {
        if (jobManager == address(0)) {
            revert InvalidJobManagerAddress();
        }
        _jobManager = jobManager;
        emit JobManagerSet(jobManager);
    }

    function getJobManager() external view returns (address) {
        return _jobManager;
    }

    // ---- lifecycle ----
    function commitDataset(
        uint256 rowCount,
        bytes32 merkleRoot,
        uint256 numColumns,
        externalEuint32 kAnonymity,
        bytes calldata inputProof,
        uint32 cooldownSec
    ) external returns (uint256 datasetId) {
        // Ensure JobManager is set before allowing dataset commits
        if (_jobManager == address(0)) {
            revert JobManagerNotSet();
        }

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

        // Generate new dataset ID
        datasetId = _nextDatasetId++;

        // Ensure dataset doesn't already exist (should never happen with auto-increment)
        Dataset storage dataset = _datasets[datasetId];
        if (dataset.exists) {
            revert DatasetNotFound(); // This should never happen, but just in case
        }

        // Create new dataset with caller as owner
        dataset.owner = msg.sender;
        dataset.exists = true;

        // Convert external encrypted value to internal euint32
        euint32 internalKAnonymity = FHE.fromExternal(kAnonymity, inputProof);
      
        FHE.allowThis(internalKAnonymity);
        FHE.allow(internalKAnonymity, msg.sender);
        FHE.allow(internalKAnonymity, _jobManager);

        // Set the dataset properties
        dataset.merkleRoot = merkleRoot;
        dataset.numColumns = numColumns;
        dataset.rowCount = rowCount;
        dataset.kAnonymity = internalKAnonymity;
        dataset.cooldownSec = cooldownSec;

        emit DatasetCommitted(datasetId, merkleRoot, numColumns, rowCount, msg.sender, internalKAnonymity, cooldownSec);
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
