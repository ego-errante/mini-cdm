// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    euint32,
    euint64,
    ebool,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IJobManager} from "./IJobManager.sol";
import {IDatasetRegistry} from "./IDatasetRegistry.sol";
import {RowDecoder} from "./RowDecoder.sol";
contract JobManager is IJobManager, SepoliaConfig {
    // ---- dependencies ----
    IDatasetRegistry public immutable DATASET_REGISTRY;

    // ---- structs ----
    struct Job {
        JobParams params;
        address buyer;
        uint256 datasetId;
        bool isOpen;
        bool isFinalized;
        euint64 result;
    }

    constructor(address datasetRegistry) {
        DATASET_REGISTRY = IDatasetRegistry(datasetRegistry);
    }

    // ---- state ----
    uint256 private _nextJobId;
    mapping(uint256 jobId => Job job) private _jobs;

    // Job state accumulators
    mapping(bytes32 key => uint64 timestamp) private _lastUse; // keccak(buyer,datasetId) -> last finalize ts

    // Merkle proof verification: track last processed row per job (enforce ascending order)
    mapping(uint256 jobId => uint256 lastRowIndex) private _jobLastProcessedRow; // jobId => lastProcessedRowIndex

    struct JobState {
        euint64 agg; // sum / weighted_sum accumulator
        euint64 minV;
        euint64 maxV;
        euint32 kept; // encrypted counter of kept rows
        bool minMaxInit;
    }
    mapping(uint256 jobId => JobState jobState) private _state;

    // ---- views ----
    function nextJobId() external view returns (uint256) {
        return _nextJobId;
    }

    function jobBuyer(uint256 jobId) external view returns (address) {
        return _jobs[jobId].buyer;
    }

    function jobOpen(uint256 jobId) external view returns (bool) {
        return _jobs[jobId].isOpen;
    }

    function jobDataset(uint256 jobId) external view returns (uint256) {
        return _jobs[jobId].datasetId;
    }

    // ---- lifecycle ----
    function openJob(
        uint256 datasetId,
        address buyer,
        JobParams calldata params
    ) external returns (uint256 jobId) {
        if (!DATASET_REGISTRY.doesDatasetExist(datasetId)) {
            revert DatasetNotFound();
        }

        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }

        euint64 initValue = FHE.asEuint64(0);

        jobId = _nextJobId++;
        _jobs[jobId] = Job({
            params: params,
            buyer: buyer,
            datasetId: datasetId,
            isOpen: true,
            isFinalized: false,
            result: initValue
        });

        _jobLastProcessedRow[jobId] = type(uint256).max; // Initialize to max to indicate no rows processed yet

        // Initialize job state with provided initial value
        _state[jobId] = JobState({
            agg: initValue,
            minV: initValue,
            maxV: initValue,
            kept: FHE.asEuint32(initValue),
            minMaxInit: false
        });

        FHE.allowThis(initValue);

        FHE.allowThis(_state[jobId].kept);

        emit JobOpened(jobId, datasetId, msg.sender);
    }

    function _isJobBuyer(uint256 jobId) internal view returns (bool) {
        return _jobs[jobId].buyer == msg.sender;
    }

    function _isDatasetOwner(uint256 datasetId) internal view returns (bool) {
        return DATASET_REGISTRY.isDatasetOwner(datasetId, msg.sender);
    }

    function _isJobOpen(uint256 jobId) internal view returns (bool) {
        return _jobs[jobId].isOpen;
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

        // 2. Enforce ascending sequential processing (since ops are order-independent, we can force ascending order)
        if (_jobLastProcessedRow[jobId] == type(uint256).max) {
            // No rows processed yet, expect rowIndex == 0
            if (rowIndex != 0) {
                revert RowOutOfOrder();
            }
        } else {
            // Expect next sequential row
            if (rowIndex != _jobLastProcessedRow[jobId] + 1) {
                revert RowOutOfOrder();
            }
        }

        uint256 datasetId = _jobs[jobId].datasetId;
        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }

        // 3. Get dataset info from registry
        (bytes32 merkleRoot, , , ,) = DATASET_REGISTRY.getDataset(datasetId);

        // 4. Compute expected leaf hash: keccak256(abi.encodePacked(datasetId, rowIndex, rowPacked))
        bytes32 expectedLeaf = keccak256(abi.encodePacked(datasetId, rowIndex, rowPacked));

        // 5. Verify merkle proof
        if (!_verifyMerkleProof(merkleProof, rowIndex, expectedLeaf, merkleRoot)) {
            revert MerkleVerificationFailed();
        }

        // 6. Update last processed row index
        _jobLastProcessedRow[jobId] = rowIndex;

        // 7. Decode row and process (streaming aggregation)
        euint64[] memory fields = RowDecoder.decodeRowTo64(rowPacked);

        if (!DATASET_REGISTRY.isRowSchemaValid(datasetId, fields.length)) {
            revert InvalidRowSchema();
        }

        JobParams memory params = _jobs[jobId].params;

        // 8. Evaluate filter (Step 3: Filter VM skeleton)
        ebool keep = _evalFilter(params.filter, fields);

        // 9. Update accumulators (Step 4: COUNT operation)
        _updateAccumulators(jobId, params, fields, keep);

        emit RowPushed(jobId);
    }

    function finalize(uint256 jobId) external {
        if (!_isJobOpen(jobId)) {
            revert JobClosed();
        }

        // Validate that all rows have been processed
        uint256 datasetId = _jobs[jobId].datasetId;
        (, , uint256 rowCount, , ) = DATASET_REGISTRY.getDataset(datasetId);

        if (_jobLastProcessedRow[jobId] != rowCount - 1) {
            revert IncompleteProcessing();
        }

        JobParams memory params = _jobs[jobId].params;
        JobState memory state = _state[jobId];

        euint64 result;
        // Return appropriate result based on operation type
        if (params.op == Op.COUNT) {
            result = FHE.asEuint64(state.kept);
        } else if (params.op == Op.SUM) {
            result = state.agg; // Return the accumulated sum
        } else {
            result = FHE.asEuint64(0); // placeholder for unimplemented ops
        }

        // TODO: Apply post-processing (clamp, roundBucket) in Step 6
        // TODO: Apply privacy gates (k-anonymity, cooldown) in Step 7

        _jobs[jobId].isOpen = false;
        _jobs[jobId].isFinalized = true;
        _jobs[jobId].result = result;
        
        address buyer = _jobs[jobId].buyer;

        FHE.allowThis(result);
        FHE.allow(result, buyer);

        emit JobFinalized(jobId, buyer, result);
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
    /// @param fields The decrypted row fields
    /// @param keep Whether to include this row (from filter evaluation)
    function _updateAccumulators(
        uint256 jobId,
        JobParams memory params,
        euint64[] memory fields,
        ebool keep
    ) internal {
        if (params.op == Op.COUNT) {
            // COUNT: increment kept counter when filter passes
            euint32 increment = FHE.select(keep, FHE.asEuint32(1), FHE.asEuint32(0));

            _state[jobId].kept = FHE.add(_state[jobId].kept, increment);

            FHE.allowThis(_state[jobId].kept);
        } else if (params.op == Op.SUM) {
            // SUM: add target field value when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 increment = FHE.select(keep, targetValue, FHE.asEuint64(0));

            _state[jobId].agg = FHE.add(_state[jobId].agg, increment);

            FHE.allowThis(_state[jobId].agg);
        }

        // TODO: Add AVG_P, WEIGHTED_SUM, MIN, MAX in later steps
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
