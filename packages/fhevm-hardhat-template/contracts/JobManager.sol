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
    // ========================================
    // CONSTANTS AND OPCODES
    // ========================================

    // ---- Filter VM limits ----
    uint256 constant MAX_FILTER_BYTECODE_LENGTH = 512;
    uint256 constant MAX_FILTER_CONSTS_LENGTH = 64;

    // ---- Filter VM opcodes ----
    // Value operations
    uint8 constant PUSH_FIELD = 0x01;
    uint8 constant PUSH_CONST = 0x02;

    // Comparators (GT, GE, LT, LE, EQ, NE)
    uint8 constant GT = 0x10;
    uint8 constant GE = 0x11;
    uint8 constant LT = 0x12;
    uint8 constant LE = 0x13;
    uint8 constant EQ = 0x14;
    uint8 constant NE = 0x15;

    // Logical operations
    uint8 constant AND = 0x20;
    uint8 constant OR = 0x21;
    uint8 constant NOT = 0x22;

    // ========================================
    // DEPENDENCIES
    // ========================================

    IDatasetRegistry public immutable DATASET_REGISTRY;

    // ========================================
    // STRUCTS
    // ========================================

    struct Job {
        JobParams params;
        address buyer;
        uint256 datasetId;
        bool isOpen;
        bool isFinalized;
        euint64 result;
    }

    struct JobState {
        euint64 agg; // sum / weighted_sum accumulator
        euint64 minV;
        euint64 maxV;
        euint32 kept; // encrypted counter of kept rows
        ebool minMaxInit;
    }

    // ========================================
    // STATE VARIABLES
    // ========================================

    constructor(address datasetRegistry) {
        DATASET_REGISTRY = IDatasetRegistry(datasetRegistry);
    }

    uint256 private _nextJobId;
    mapping(uint256 jobId => Job job) private _jobs;

    // Job state accumulators
    mapping(uint256 jobId => JobState jobState) private _state;

    // Cooldown tracking: keccak(buyer,datasetId) -> last finalize timestamp
    mapping(bytes32 key => uint64 timestamp) private _lastUse;

    // Merkle proof verification: track last processed row per job (enforce ascending order)
    mapping(uint256 jobId => uint256 lastRowIndex) private _jobLastProcessedRow;

    // ========================================
    // VIEW FUNCTIONS
    // ========================================

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

    // ========================================
    // JOB LIFECYCLE FUNCTIONS
    // ========================================
    function openJob(
        uint256 datasetId,
        address buyer,
        JobParams calldata params
    ) external returns (uint256 jobId) {
        // Orchestrator function - delegates to smaller helper functions
        _validateDatasetAccess(datasetId);
        _validateJobParameters(datasetId, params);
        _checkCooldownPeriod(buyer, datasetId);
        jobId = _initializeJobState(datasetId, buyer, params);

        emit JobOpened(jobId, datasetId, msg.sender);
    }

    /// @notice Validates that dataset exists and caller is owner
    /// @param datasetId The dataset ID to validate
    function _validateDatasetAccess(uint256 datasetId) internal view {
        if (!DATASET_REGISTRY.doesDatasetExist(datasetId)) {
            revert DatasetNotFound();
        }

        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }
    }

    /// @notice Validates all job parameters against dataset constraints
    /// @param datasetId The dataset ID
    /// @param params The job parameters to validate
    function _validateJobParameters(uint256 datasetId, JobParams calldata params) internal view {
        // Validate divisor for AVG_P operation
        if (params.op == Op.AVG_P && params.divisor == 0) {
            revert CannotDivideByZero();
        }

        // Get dataset info for field validation
        (, uint256 numColumns, , , , , ) = DATASET_REGISTRY.getDataset(datasetId);

        // Validate target field for operations that use it
        if (
            params.op == Op.SUM || params.op == Op.AVG_P || params.op == Op.MIN
                || params.op == Op.MAX
        ) {
            if (params.targetField >= numColumns) {
                revert InvalidFieldIndex();
            }
        }

        // Validate clamp range
        if (params.clampMax > 0 && params.clampMin > params.clampMax) {
            revert InvalidClampRange();
        }

        // Validate filter bytecode and constants length
        if (params.filter.bytecode.length > MAX_FILTER_BYTECODE_LENGTH) {
            revert FilterBytecodeTooLong();
        }
        if (params.filter.consts.length > MAX_FILTER_CONSTS_LENGTH) {
            revert FilterConstsTooLong();
        }

        // Validate weights length for WEIGHTED_SUM
        if (params.op == Op.WEIGHTED_SUM) {
            if (params.weights.length != numColumns) {
                revert WeightsLengthMismatch();
            }
        }
    }

    /// @notice Checks if cooldown period is active for buyer-dataset pair
    /// @param buyer The buyer address
    /// @param datasetId The dataset ID
    function _checkCooldownPeriod(address buyer, uint256 datasetId) internal view {
        (,,,,,, uint32 cooldownSec) = DATASET_REGISTRY.getDataset(datasetId);
        if (cooldownSec > 0) {
            bytes32 cooldownKey = keccak256(abi.encodePacked(buyer, datasetId));
            uint64 lastUse = _lastUse[cooldownKey];

            if (lastUse > 0 && block.timestamp < lastUse + cooldownSec) {
                revert CooldownActive();
            }
        }
    }

    /// @notice Initializes job state and returns job ID
    /// @param datasetId The dataset ID
    /// @param buyer The buyer address
    /// @param params The job parameters
    /// @return jobId The assigned job ID
    function _initializeJobState(
        uint256 datasetId,
        address buyer,
        JobParams calldata params
    ) internal returns (uint256 jobId) {
        euint64 initValue = FHE.asEuint64(0);
        ebool initMinMaxInit = FHE.asEbool(false);

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
            minMaxInit: initMinMaxInit
        });

        FHE.allowThis(initValue);
        FHE.allowThis(_state[jobId].kept);
        FHE.allowThis(initMinMaxInit);
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
        // Orchestrator function - delegates to smaller helper functions
        // Fetch storage pointer once for gas efficiency
        Job storage job = _jobs[jobId];

        _validateRowProcessing(job, jobId, rowIndex);
        _verifyRowIntegrity(job, jobId, rowPacked, merkleProof, rowIndex);
        _processRowData(job, jobId, rowPacked);

        emit RowPushed(jobId);
    }

    /// @notice Validates job state and row processing order
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @param rowIndex The row index being processed
    function _validateRowProcessing(Job storage job, uint256 jobId, uint256 rowIndex) internal view {
        // Basic job validation
        if (!job.isOpen) {
            revert JobClosed();
        }

        // Enforce ascending sequential processing
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
    }

    /// @notice Verifies dataset ownership and merkle proof integrity
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @param rowPacked The packed row data
    /// @param merkleProof The merkle proof for the row
    /// @param rowIndex The row index
    function _verifyRowIntegrity(
        Job storage job,
        uint256 jobId,
        bytes calldata rowPacked,
        bytes32[] calldata merkleProof,
        uint256 rowIndex
    ) internal {
        uint256 datasetId = job.datasetId;

        if (!_isDatasetOwner(datasetId)) {
            revert NotDatasetOwner();
        }

        // Get dataset info from registry
        (bytes32 merkleRoot, , , , , , ) = DATASET_REGISTRY.getDataset(datasetId);

        // Compute expected leaf hash
        bytes32 expectedLeaf = keccak256(abi.encodePacked(datasetId, rowIndex, rowPacked));

        // Verify merkle proof
        if (!_verifyMerkleProof(merkleProof, rowIndex, expectedLeaf, merkleRoot)) {
            revert MerkleVerificationFailed();
        }

        // Update last processed row index
        _jobLastProcessedRow[jobId] = rowIndex;
    }

    /// @notice Processes the row data through filtering and accumulation
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @param rowPacked The packed row data
    function _processRowData(
        Job storage job,
        uint256 jobId,
        bytes calldata rowPacked
    ) internal {
        uint256 datasetId = job.datasetId;
        // Decode row and validate schema
        euint64[] memory fields = RowDecoder.decodeRowTo64(rowPacked);

        if (!DATASET_REGISTRY.isRowSchemaValid(datasetId, fields.length)) {
            revert InvalidRowSchema();
        }

        // Get job parameters and process
        JobParams memory params = job.params;
        ebool keep = _evalFilter(params.filter, fields);
        _updateAccumulators(jobId, params, fields, keep);
    }

    function finalize(uint256 jobId) external {
        // Orchestrator function - delegates to smaller helper functions
        // Fetch storage pointer once for gas efficiency
        Job storage job = _jobs[jobId];

        _validateFinalization(job, jobId);
        euint64 result = _computeJobResult(job, jobId);
        result = _applyPostProcessing(job, result);
        _finalizeJobState(job, result);

        emit JobFinalized(jobId, job.buyer, result);
    }

    /// @notice Validates that job can be finalized (open and all rows processed)
    /// @param job The storage pointer to the job to validate
    /// @param jobId The job ID
    function _validateFinalization(Job storage job, uint256 jobId) internal view {
        if (!job.isOpen) {
            revert JobClosed();
        }

        // Validate that all rows have been processed
        uint256 datasetId = job.datasetId;
        (, , uint256 rowCount, , , , ) = DATASET_REGISTRY.getDataset(datasetId);

        if (_jobLastProcessedRow[jobId] != rowCount - 1) {
            revert IncompleteProcessing();
        }
    }

    /// @notice Computes the final result based on operation type
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @return result The computed encrypted result
    function _computeJobResult(Job storage job, uint256 jobId) internal returns (euint64 result) {
        JobParams memory params = job.params;
        JobState memory state = _state[jobId];

        // Return appropriate result based on operation type
        if (params.op == Op.COUNT) {
            result = FHE.asEuint64(state.kept);
        } else if (params.op == Op.SUM) {
            result = state.agg; // Return the accumulated sum
        } else if (params.op == Op.AVG_P) {
            // Apply divisor to get average
            result = FHE.div(state.agg, params.divisor);
        } else if (params.op == Op.WEIGHTED_SUM) {
            result = state.agg; // Return the accumulated weighted sum
        } else if (params.op == Op.MIN) {
            result = state.minV; // Return the minimum value
        } else if (params.op == Op.MAX) {
            result = state.maxV; // Return the maximum value
        } else {
            result = FHE.asEuint64(0); // placeholder for unimplemented ops
        }
    }

    /// @notice Applies post-processing transformations (clamp, roundBucket)
    /// @param job The storage pointer to the job
    /// @param result The result to post-process
    /// @return processedResult The post-processed result
    function _applyPostProcessing(Job storage job, euint64 result) internal returns (euint64 processedResult) {
        processedResult = result;
        JobParams memory params = job.params;

        // Apply post-processing (clamp, roundBucket)
        if (params.clampMin > 0 || params.clampMax > 0) {
            processedResult = _clamp(processedResult, params.clampMin, params.clampMax);
        }
        if (params.roundBucket > 0) {
            processedResult = _roundBucket(processedResult, params.roundBucket);
        }

        // TODO: Apply privacy gates (k-anonymity) in Step 7
    }

    /// @notice Finalizes job state and handles cooldown
    /// @param job The storage pointer to the job
    /// @param result The final result
    function _finalizeJobState(Job storage job, euint64 result) internal {
        uint256 datasetId = job.datasetId;
        address buyer = job.buyer;

        // Update job state
        job.isOpen = false;
        job.isFinalized = true;
        job.result = result;

        // Set FHE permissions
        FHE.allowThis(result);
        FHE.allow(result, buyer);

        // Handle cooldown
        (,,,,,, uint32 cooldownSec) = DATASET_REGISTRY.getDataset(datasetId);
        if (cooldownSec > 0) {
            bytes32 cooldownKey = keccak256(abi.encodePacked(buyer, datasetId));
            _lastUse[cooldownKey] = uint64(block.timestamp);
        }
    }

    // ========================================
    // IMPLEMENTATION FUNCTIONS
    // ========================================

    // ---- Filter VM Implementation ----
    /// @notice Evaluates filter bytecode against encrypted row fields
    /// @param filter The filter program with bytecode and constants
    /// @param fields The decrypted row fields as euint64 values
    /// @return keep Whether the row should be kept (encrypted boolean)
    function _evalFilter(FilterProg memory filter, euint64[] memory fields) internal returns (ebool) {
        // Phase A: Empty filter = accept all
        if (filter.bytecode.length == 0) {
            return FHE.asEbool(true);
        }

        // Initialize VM stacks (fixed size for simplicity)
        // euint64 value stack (for encrypted values)
        euint64[8] memory valueStack;
        uint8 valueSp = 0;

        // uint64 plaintext constants stack (for plaintext values)
        uint64[8] memory constStack;
        uint8 constSp = 0;

        // ebool boolean stack (for encrypted boolean results)
        ebool[8] memory boolStack;
        uint8 boolSp = 0;

        // Main VM execution loop
        uint256 pc = 0; // program counter
        while (pc < filter.bytecode.length) {
            uint8 opcode = uint8(filter.bytecode[pc]);
            pc++;

            if (opcode == PUSH_FIELD) {
                // PUSH_FIELD: read 16-bit field index, push encrypted field value
                if (pc + 2 > filter.bytecode.length) revert FilterVMInsufficientBytecode();
                uint16 fieldIdx = (uint16(uint8(filter.bytecode[pc])) << 8) | uint16(uint8(filter.bytecode[pc + 1]));
                pc += 2;

                if (fieldIdx >= fields.length) revert FilterVMInvalidFieldIndex();
                if (valueSp >= valueStack.length) revert FilterVMStackOverflow("value");

                valueStack[valueSp] = fields[fieldIdx];
                valueSp++;

            } else if (opcode == PUSH_CONST) {
                // PUSH_CONST: read 16-bit const index, push plaintext constant
                if (pc + 2 > filter.bytecode.length) revert FilterVMInsufficientBytecode();
                uint16 constIdx = (uint16(uint8(filter.bytecode[pc])) << 8) | uint16(uint8(filter.bytecode[pc + 1]));
                pc += 2;

                if (constIdx >= filter.consts.length) revert FilterVMInvalidConstantIndex();
                if (constSp >= constStack.length) revert FilterVMStackOverflow("const");

                constStack[constSp] = uint64(filter.consts[constIdx]);
                constSp++;

            } else if (opcode >= GT && opcode <= NE) {
                // Comparators: pop encrypted value and plaintext const, compare, push result
                if (valueSp == 0) revert FilterVMStackUnderflow("value");
                if (constSp == 0) revert FilterVMStackUnderflow("const");
                if (boolSp >= boolStack.length) revert FilterVMStackOverflow("bool");

                valueSp--;
                constSp--;

                euint64 encryptedVal = valueStack[valueSp];
                uint64 plainVal = constStack[constSp];

                ebool result;
                if (opcode == GT) {
                    result = FHE.gt(encryptedVal, plainVal);
                } else if (opcode == GE) {
                    result = FHE.ge(encryptedVal, plainVal);
                } else if (opcode == LT) {
                    result = FHE.lt(encryptedVal, plainVal);
                } else if (opcode == LE) {
                    result = FHE.le(encryptedVal, plainVal);
                } else if (opcode == EQ) {
                    result = FHE.eq(encryptedVal, plainVal);
                } else if (opcode == NE) {
                    result = FHE.ne(encryptedVal, plainVal);
                }

                boolStack[boolSp] = result;
                boolSp++;

            } else if (opcode == NOT) {
                // NOT: pop one boolean, perform logical NOT, push result
                if (boolSp == 0) revert FilterVMStackUnderflow("bool");

                boolSp--;
                ebool operand = boolStack[boolSp];

                ebool result = FHE.not(operand);

                if (boolSp >= boolStack.length) revert FilterVMStackOverflow("bool");
                boolStack[boolSp] = result;
                boolSp++;

            } else if (opcode == AND || opcode == OR) {
                // AND/OR: pop two booleans, perform logical operation, push result
                if (boolSp < 2) revert FilterVMStackUnderflow("bool");

                boolSp -= 2;
                ebool right = boolStack[boolSp];
                ebool left = boolStack[boolSp + 1];

                ebool result;
                if (opcode == AND) {
                    result = FHE.and(left, right);
                } else { // OR
                    result = FHE.or(left, right);
                }

                if (boolSp >= boolStack.length) revert FilterVMStackOverflow("bool");
                boolStack[boolSp] = result;
                boolSp++;

            } else {
                revert FilterVMUnknownOpcode(opcode);
            }
        }

        // Final result: boolean stack should contain exactly one value
        if (boolSp != 1) revert FilterVMInvalidFinalStackState();

        // All stacks should be empty except for the final boolean result
        if (valueSp != 0) revert FilterVMStackNotEmpty("value");
        if (constSp != 0) revert FilterVMStackNotEmpty("const");

        // Return the final boolean result
        return boolStack[0];
    }

    // ---- Accumulator Updates ----
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
        } else if (params.op == Op.SUM || params.op == Op.AVG_P) {
            // SUM and AVG_P: add target field value when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 increment = FHE.select(keep, targetValue, FHE.asEuint64(0));

            _state[jobId].agg = FHE.add(_state[jobId].agg, increment);

            FHE.allowThis(_state[jobId].agg);
        } else if (params.op == Op.WEIGHTED_SUM) {
            // WEIGHTED_SUM: compute weighted sum of fields using sequential indices when filter passes
            euint64 weightedSum = FHE.asEuint64(0);

            for (uint256 i = 0; i < params.weights.length; i++) {
                uint16 weight = params.weights[i];
                euint64 fieldValue = fields[i];
                euint64 weightedValue = FHE.mul(fieldValue, uint64(weight));

                weightedSum = FHE.add(weightedSum, weightedValue);
            }

            // Add weighted sum to accumulator when filter passes
            euint64 increment = FHE.select(keep, weightedSum, FHE.asEuint64(0));
            _state[jobId].agg = FHE.add(_state[jobId].agg, increment);

            FHE.allowThis(_state[jobId].agg);
        } else if (params.op == Op.MIN) {
            // MIN: track minimum value of target field when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 currentMin = _state[jobId].minV;
            ebool isInitialized = _state[jobId].minMaxInit;

            // If initialized, the candidate is min(current, target). Otherwise, it's just the target value.
            euint64 newMinIfKept = FHE.select(isInitialized, FHE.min(currentMin, targetValue), targetValue);

            // Only update if the row is kept. Otherwise, retain the old value.
            _state[jobId].minV = FHE.select(keep, newMinIfKept, currentMin);

            // The accumulator is initialized if it was already initialized OR if this row was kept.
            _state[jobId].minMaxInit = FHE.or(isInitialized, keep);

            FHE.allowThis(_state[jobId].minV);
            FHE.allowThis(_state[jobId].minMaxInit);
        } else if (params.op == Op.MAX) {
            // MAX: track maximum value of target field when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 currentMax = _state[jobId].maxV;
            ebool isInitialized = _state[jobId].minMaxInit;

            // If initialized, the candidate is max(current, target). Otherwise, it's just the target value.
            euint64 newMaxIfKept = FHE.select(isInitialized, FHE.max(currentMax, targetValue), targetValue);

            // Only update if the row is kept. Otherwise, retain the old value.
            _state[jobId].maxV = FHE.select(keep, newMaxIfKept, currentMax);

            // The accumulator is initialized if it was already initialized OR if this row was kept.
            _state[jobId].minMaxInit = FHE.or(isInitialized, keep);

            FHE.allowThis(_state[jobId].maxV);
            FHE.allowThis(_state[jobId].minMaxInit);
        }
    }

    // ---- Merkle Proof Verification ----
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
            assembly {
                // Depending on whether the index is even or odd, we hash(computed, proof) or hash(proof, computed).
                // We check for evenness with iszero(and(index, 1)), which is cheaper than mod(index, 2) == 0.
                switch iszero(and(index, 1))
                case 1 { // index is even: computedHash is on the left
                    mstore(0x00, computedHash)
                    mstore(0x20, proofElement)
                }
                default { // index is odd: proofElement is on the left
                    mstore(0x00, proofElement)
                    mstore(0x20, computedHash)
                }
                // Hash the 64-byte memory space from 0x00 to 0x40.
                computedHash := keccak256(0x00, 0x40)
            }
            // Right-shift by 1 is cheaper than division by 2.
            index >>= 1;
        }

        return computedHash == root;
    }

    // ---- Post-processing Helpers ----
    /// @notice Clamps an encrypted value to the specified min/max bounds
    /// @param value The encrypted value to clamp
    /// @param minBound The minimum bound (0 means no minimum)
    /// @param maxBound The maximum bound (0 means no maximum)
    /// @return The clamped encrypted value
    function _clamp(euint64 value, uint64 minBound, uint64 maxBound) internal returns (euint64) {
        euint64 clamped = value;

        // Apply minimum bound if specified
        if (minBound > 0) {
            clamped = FHE.max(clamped, minBound);
        }

        // Apply maximum bound if specified
        if (maxBound > 0) {
            clamped = FHE.min(clamped, maxBound);
        }

        return clamped;
    }

    /// @notice Rounds an encrypted value to the nearest multiple of bucket size
    /// @param value The encrypted value to round
    /// @param bucket The bucket size to round to
    /// @return The rounded encrypted value
    function _roundBucket(euint64 value, uint32 bucket) internal returns (euint64) {
        if (bucket == 0) return value;

        // Convert bucket to uint64 for FHE operations
        uint64 bucket64 = uint64(bucket);

        // Calculate: ((value + bucket/2) / bucket) * bucket
        // This rounds to nearest multiple, with halfway cases rounding up
        euint64 halfBucket = FHE.asEuint64(bucket64 / 2);
        euint64 sum = FHE.add(value, halfBucket);
        euint64 quotient = FHE.div(sum, bucket64);
        euint64 result = FHE.mul(quotient, bucket64);

        return result;
    }
}
