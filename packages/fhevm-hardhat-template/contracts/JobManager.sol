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
        ebool minMaxInit;
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

        // Validate job parameters
        if (params.op == Op.AVG_P && params.divisor == 0) {
            revert CannotDivideByZero();
        }

        if (params.op == Op.WEIGHTED_SUM) {
            // Get expected field count from dataset registry
            (, uint256 numColumns, , , ) = DATASET_REGISTRY.getDataset(datasetId);
            if (params.weights.length != numColumns) {
                revert WeightsLengthMismatch();
            }
        }

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

    // ---- Step 3: Filter VM implementation ----
    // Phase 1: VM structure with opcodes
    // Phase 2: PUSH_FIELD, PUSH_CONST
    // Phase 3: Comparators (GT, GE, LT, LE, EQ, NE)
    // Phase 4: Logical operations (AND, OR, NOT)

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
                require(pc + 2 <= filter.bytecode.length, "PUSH_FIELD: insufficient bytecode");
                uint16 fieldIdx = (uint16(uint8(filter.bytecode[pc])) << 8) | uint16(uint8(filter.bytecode[pc + 1]));
                pc += 2;

                require(fieldIdx < fields.length, "PUSH_FIELD: invalid field index");
                require(valueSp < valueStack.length, "PUSH_FIELD: value stack overflow");

                valueStack[valueSp] = fields[fieldIdx];
                valueSp++;

            } else if (opcode == PUSH_CONST) {
                // PUSH_CONST: read 16-bit const index, push plaintext constant
                require(pc + 2 <= filter.bytecode.length, "PUSH_CONST: insufficient bytecode");
                uint16 constIdx = (uint16(uint8(filter.bytecode[pc])) << 8) | uint16(uint8(filter.bytecode[pc + 1]));
                pc += 2;

                require(constIdx < filter.consts.length, "PUSH_CONST: invalid const index");
                require(constSp < constStack.length, "PUSH_CONST: const stack overflow");

                constStack[constSp] = uint64(filter.consts[constIdx]);
                constSp++;

            } else if (opcode >= GT && opcode <= NE) {
                // Comparators: pop encrypted value and plaintext const, compare, push result
                require(valueSp > 0, "Comparator: value stack underflow");
                require(constSp > 0, "Comparator: const stack underflow");
                require(boolSp < boolStack.length, "Comparator: bool stack overflow");

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
                require(boolSp > 0, "NOT: bool stack underflow");

                boolSp--;
                ebool operand = boolStack[boolSp];

                ebool result = FHE.not(operand);

                require(boolSp < boolStack.length, "NOT: bool stack overflow");
                boolStack[boolSp] = result;
                boolSp++;

            } else if (opcode == AND || opcode == OR) {
                // AND/OR: pop two booleans, perform logical operation, push result
                require(boolSp >= 2, "AND/OR: bool stack underflow");

                boolSp -= 2;
                ebool right = boolStack[boolSp];
                ebool left = boolStack[boolSp + 1];

                ebool result;
                if (opcode == AND) {
                    result = FHE.and(left, right);
                } else { // OR
                    result = FHE.or(left, right);
                }

                require(boolSp < boolStack.length, "AND/OR: bool stack overflow");
                boolStack[boolSp] = result;
                boolSp++;

            } else {
                revert("Unknown opcode");
            }
        }

        // Final result: boolean stack should contain exactly one value
        require(boolSp == 1, "Filter VM: invalid final stack state - must have exactly one boolean result");

        // All stacks should be empty except for the final boolean result
        require(valueSp == 0, "Filter VM: value stack not empty after execution");
        require(constSp == 0, "Filter VM: const stack not empty after execution");

        // Return the final boolean result
        return boolStack[0];
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

            // if not initialized, new min is target value if row is kept, otherwise current value (0)
            euint64 minIfNotInit = FHE.select(keep, targetValue, currentMin);
            // if initialized, new min is min(current, target) if row is kept, otherwise current value
            euint64 minIfInit = FHE.select(keep, FHE.min(currentMin, targetValue), currentMin);

            // select between the two based on whether we were already initialized
            _state[jobId].minV = FHE.select(isInitialized, minIfInit, minIfNotInit);
            // new state is (isInitialized OR keep)
            _state[jobId].minMaxInit = FHE.or(isInitialized, keep);

            FHE.allowThis(_state[jobId].minV);
            FHE.allowThis(_state[jobId].minMaxInit);
        } else if (params.op == Op.MAX) {
            // MAX: track maximum value of target field when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 currentMax = _state[jobId].maxV;
            ebool isInitialized = _state[jobId].minMaxInit;

            // if not initialized, new max is target value if row is kept, otherwise current value (0)
            euint64 maxIfNotInit = FHE.select(keep, targetValue, currentMax);
            // if initialized, new max is max(current, target) if row is kept, otherwise current value
            euint64 maxIfInit = FHE.select(keep, FHE.max(currentMax, targetValue), currentMax);

            // select between the two based on whether we were already initialized
            _state[jobId].maxV = FHE.select(isInitialized, maxIfInit, maxIfNotInit);
            // new state is (isInitialized OR keep)
            _state[jobId].minMaxInit = FHE.or(isInitialized, keep);

            FHE.allowThis(_state[jobId].maxV);
            FHE.allowThis(_state[jobId].minMaxInit);
        }
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
