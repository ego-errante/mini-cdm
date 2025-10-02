// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    euint32,
    externalEuint32,
    externalEuint8,
    externalEuint64,
    euint64,
    ebool
} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IJobManager} from "./IJobManager.sol";
import {IDatasetRegistry} from "./IDatasetRegistry.sol";
import {RowDecoder} from "./RowDecoder.sol";

contract JobManager is IJobManager, SepoliaConfig {
    // ---- dependencies ----
    IDatasetRegistry public immutable datasetRegistry;

    constructor(address _datasetRegistry) {
        datasetRegistry = IDatasetRegistry(_datasetRegistry);
    }

    // ---- state ----
    uint256 private _nextJobId;
    mapping(uint256 => JobParams) private _jobs;
    mapping(uint256 => address) private _jobBuyer;
    mapping(uint256 => bool) private _jobOpen;
    mapping(uint256 => uint256) private _jobDataset;
    mapping(uint256 => bool) private _finalized;

    // Job state accumulators
    mapping(bytes32 => uint64) private _lastUse; // keccak(buyer,datasetId) -> last finalize ts

    // Merkle proof verification: track consumed rows per job
    mapping(uint256 => mapping(uint256 => bool)) private _jobConsumedRows; // jobId => rowIndex => consumed

    struct JobState {
        euint64 agg; // sum / weighted_sum accumulator
        euint64 minV;
        euint64 maxV;
        euint32 kept; // encrypted counter of kept rows
        bool minMaxInit;
    }
    mapping(uint256 => JobState) private _state;

    // ---- views ----
    function nextJobId() external view returns (uint256) {
        return _nextJobId;
    }

    function jobBuyer(uint256 jobId) external view returns (address) {
        return _jobBuyer[jobId];
    }

    function jobOpen(uint256 jobId) external view returns (bool) {
        return _jobOpen[jobId];
    }

    function jobDataset(uint256 jobId) external view returns (uint256) {
        return _jobDataset[jobId];
    }

    // ---- lifecycle ----
    function openJob(uint256 datasetId, address buyer, JobParams calldata params) external returns (uint256 jobId) {
        if (!datasetRegistry.doesDatasetExist(datasetId)) {
            revert DatasetNotFound();
        }

        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }

        jobId = _nextJobId++;
        _jobs[jobId] = params;
        _jobBuyer[jobId] = buyer;
        _jobOpen[jobId] = true;
        _jobDataset[jobId] = datasetId;

        // Initialize job state with encrypted zeros
        _state[jobId] = JobState({
            agg: FHE.asEuint64(0),
            minV: FHE.asEuint64(0),
            maxV: FHE.asEuint64(0),
            kept: FHE.asEuint32(0),
            minMaxInit: false
        });

        emit JobOpened(jobId, datasetId, msg.sender);
    }

    function _isJobBuyer(uint256 jobId) internal view returns (bool) {
        return _jobBuyer[jobId] == msg.sender;
    }

    function _isDatasetOwner(uint256 datasetId) internal view returns (bool) {
        return datasetRegistry.isDatasetOwner(datasetId, msg.sender);
    }

    function _isJobOpen(uint256 jobId) internal view returns (bool) {
        return _jobOpen[jobId];
    }

    function pushRow(
        uint256 jobId,
        bytes calldata rowPacked,
        bytes32[] calldata merkleProof,
        uint256 rowIndex
    ) external {
        // 1. Basic job validation
        if (!_isJobOpen(jobId)) {
            revert JobClosed();
        }

        uint256 datasetId = _jobDataset[jobId];
        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }

        // TODO: Ascending or descending order? does not matter due to the operations in our DSL
        // so we can force one and reduce data storage
        // 2. Check for duplicate row consumption in this job
        if (_jobConsumedRows[jobId][rowIndex]) {
            revert RowAlreadyConsumed();
        }

        // 3. Get dataset info from registry
        (bytes32 merkleRoot, , , , bool exists) = datasetRegistry.getDataset(datasetId);
        if (!exists) {
            revert DatasetNotFound();
        }

        // 4. Compute expected leaf hash: keccak256(abi.encodePacked(datasetId, rowIndex, rowPacked))
        bytes32 expectedLeaf = keccak256(abi.encodePacked(datasetId, rowIndex, rowPacked));

        // 5. Verify merkle proof
        if (!_verifyMerkleProof(merkleProof, rowIndex, expectedLeaf, merkleRoot)) {
            revert MerkleVerificationFailed();
        }

        // 6. Mark row as consumed
        _jobConsumedRows[jobId][rowIndex] = true;

        // 7. Decode row and process (streaming aggregation)
        euint64[] memory fields = RowDecoder.decodeRowTo64(rowPacked);

        if (!datasetRegistry.isRowSchemaValid(datasetId, fields.length)) {
            revert InvalidRowSchema();
        }
        
        JobParams memory params = _jobs[jobId];

        // 8. Evaluate filter (Step 3: Filter VM skeleton)
        ebool keep = _evalFilter(params.filter, fields);

        // 9. Update accumulators (Step 4: COUNT operation)
        _updateAccumulators(jobId, params, fields, keep);

        emit RowPushed(jobId);
    }

    function finalize(uint256 jobId) external returns (euint64 result) {
        if (!_isJobOpen(jobId)) {
            revert JobClosed();
        }

        JobParams memory params = _jobs[jobId];
        JobState memory state = _state[jobId];

        // For now, only COUNT is implemented - return kept counter
        if (params.op == Op.COUNT) {
            result = FHE.asEuint64(state.kept);
        } else {
            result = FHE.asEuint64(0); // placeholder for unimplemented ops
        }

        // TODO: Apply post-processing (clamp, roundBucket) in Step 6
        // TODO: Apply privacy gates (k-anonymity, cooldown) in Step 7

        _jobOpen[jobId] = false;
        emit JobFinalized(jobId, msg.sender);

        // TODO: Allow decryption for buyer in Step 11
        return result;
    }

    // ---- Step 3: Filter VM skeleton ----
    // Phase A: Accept-all when no bytecode
    // Phase B: PUSH_CONST, ALWAYS_TRUE/FALSE
    // Phase C: PUSH_FIELD idx, PUSH_CONST c, GT, LE

    /// @notice Evaluates filter bytecode against encrypted row fields
    /// @param filter The filter program with bytecode and constants
    /// @return keep Whether the row should be kept (encrypted boolean)
    function _evalFilter(FilterProg memory filter, euint64[] memory /* fields */) internal returns (ebool) {
        // Phase A: Empty filter = accept all
        if (filter.bytecode.length == 0) {
            return FHE.asEbool(true);
        }

        // TODO: Implement Phase B (PUSH_CONST, ALWAYS_TRUE/FALSE) and Phase C (PUSH_FIELD, GT, LE)
        // For now, return accept-all as placeholder
        return FHE.asEbool(true);
    }

    // ---- Step 4: COUNT operation ----
    /// @notice Updates job accumulators based on operation type and filter result
    /// @param jobId The job ID
    /// @param params The job parameters
    /// @param keep Whether to include this row (from filter evaluation)
    function _updateAccumulators(
        uint256 jobId,
        JobParams memory params,
        euint64[] memory /* fields */,
        ebool keep
    ) internal {
        if (params.op == Op.COUNT) {
            // COUNT: increment kept counter when filter passes
            euint32 increment = FHE.select(keep, FHE.asEuint32(1), FHE.asEuint32(0));
            _state[jobId].kept = FHE.add(_state[jobId].kept, increment);
        }
        // TODO: Add SUM, AVG_P, WEIGHTED_SUM, MIN, MAX in later steps
    }

    /// @notice Verifies a merkle proof against the expected leaf and root
    /// @param proof Array of proof elements
    /// @param index Position of the leaf in the tree
    /// @param leaf The expected leaf hash
    /// @param root The expected merkle root
    /// @return valid True if proof is valid
    function _verifyMerkleProof(
        bytes32[] memory proof,
        uint256 index,
        bytes32 leaf,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (index % 2 == 0) {
                // Left child: hash(current, proof)
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                // Right child: hash(proof, current)
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }

            index = index / 2;
        }

        return computedHash == root;
    }
}
