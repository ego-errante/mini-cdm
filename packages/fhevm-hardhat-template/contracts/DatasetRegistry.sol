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
    mapping(uint256 => Dataset) private _datasets;
    uint256[] private _datasetIds;
    mapping(uint256 => uint256) private _datasetIdToIndex;
    mapping(uint256 => string) private _datasetDescriptions;
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

    struct DatasetWithId {
        uint256 id;
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

    function getDatasetDescription(uint256 datasetId) external view returns (string memory) {
        return _datasetDescriptions[datasetId];
    }

    function getAllDatasetDescriptions() external view returns (DatasetDescriptionWithId[] memory) {
        uint256 count = _datasetIds.length;
        DatasetDescriptionWithId[] memory descriptions = new DatasetDescriptionWithId[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 datasetId = _datasetIds[i];
            descriptions[i] = DatasetDescriptionWithId({
                datasetId: datasetId,
                description: _datasetDescriptions[datasetId]
            });
        }

        return descriptions;
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

    // ---- enumeration ----
    function getDatasetCount() external view returns (uint256) {
        return _datasetIds.length;
    }

    function getDatasetIds(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        uint256 total = _datasetIds.length;
        if (offset >= total) {
            return new uint256[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 length = end - offset;
        uint256[] memory ids = new uint256[](length);

        for (uint256 i = 0; i < length; i++) {
            ids[i] = _datasetIds[offset + i];
        }

        return ids;
    }

    function getAllDatasetIds() external view returns (uint256[] memory) {
        return _datasetIds;
    }

    function getAllDatasets() external view returns (DatasetWithId[] memory) {
        uint256 count = _datasetIds.length;
        DatasetWithId[] memory datasets = new DatasetWithId[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 datasetId = _datasetIds[i];
            Dataset memory dataset = _datasets[datasetId];
            datasets[i] = DatasetWithId({
                id: datasetId,
                merkleRoot: dataset.merkleRoot,
                numColumns: dataset.numColumns,
                rowCount: dataset.rowCount,
                owner: dataset.owner,
                exists: dataset.exists,
                kAnonymity: dataset.kAnonymity,
                cooldownSec: dataset.cooldownSec
            });
        }

        return datasets;
    }

    function getDatasets(uint256 offset, uint256 limit)
        external
        view
        returns (DatasetWithId[] memory)
    {
        uint256 total = _datasetIds.length;
        if (offset >= total) {
            return new DatasetWithId[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        uint256 length = end - offset;
        DatasetWithId[] memory datasets = new DatasetWithId[](length);

        for (uint256 i = 0; i < length; i++) {
            uint256 datasetId = _datasetIds[offset + i];
            Dataset memory dataset = _datasets[datasetId];
            datasets[i] = DatasetWithId({
                id: datasetId,
                merkleRoot: dataset.merkleRoot,
                numColumns: dataset.numColumns,
                rowCount: dataset.rowCount,
                owner: dataset.owner,
                exists: dataset.exists,
                kAnonymity: dataset.kAnonymity,
                cooldownSec: dataset.cooldownSec
            });
        }

        return datasets;
    }

    // ---- lifecycle ----
    function commitDataset(
        uint256 datasetId,
        uint256 rowCount,
        bytes32 merkleRoot,
        uint256 numColumns,
        externalEuint32 kAnonymity,
        bytes calldata inputProof,
        uint32 cooldownSec
    ) external {
        // Ensure JobManager is set before allowing dataset commits
        if (_jobManager == address(0)) {
            revert JobManagerNotSet();
        }

        // Validate inputs
        if (rowCount == 0) {
            revert InvalidRowCount();
        }
        if (rowCount > type(uint64).max) {
            revert RowCountExceedsUint64Max();
        }
        if (merkleRoot == bytes32(0)) {
            revert InvalidMerkleRoot();
        }
        if (numColumns == 0) {
            revert InvalidNumColumns();
        }

        // Ensure dataset doesn't already exist
        Dataset storage dataset = _datasets[datasetId];
        if (dataset.exists) {
            revert DatasetAlreadyExists();
        }

        // Create new dataset with caller as owner
        dataset.owner = msg.sender;
        dataset.exists = true;

        // Add to enumeration tracking
        _datasetIdToIndex[datasetId] = _datasetIds.length;
        _datasetIds.push(datasetId);

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

        // Remove from enumeration tracking (swap and pop)
        uint256 index = _datasetIdToIndex[datasetId];
        uint256 lastIndex = _datasetIds.length - 1;

        if (index != lastIndex) {
            uint256 lastId = _datasetIds[lastIndex];
            _datasetIds[index] = lastId;
            _datasetIdToIndex[lastId] = index;
        }

        _datasetIds.pop();
        delete _datasetIdToIndex[datasetId];

        // Delete the dataset
        delete _datasets[datasetId];
        // Clear the description
        delete _datasetDescriptions[datasetId];

        emit DatasetDeleted(datasetId, msg.sender);
    }

    function setDatasetDescription(uint256 datasetId, string calldata description) external {
        Dataset storage dataset = _datasets[datasetId];

        // Check if dataset exists
        if (!dataset.exists) {
            revert DatasetNotFound();
        }

        // Check if caller is owner
        if (dataset.owner != msg.sender) {
            revert NotDatasetOwner();
        }

        // Set the description
        _datasetDescriptions[datasetId] = description;

        emit DatasetDescriptionSet(datasetId, description);
    }
}
