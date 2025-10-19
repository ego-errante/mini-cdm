// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    FHE,
    euint32,
    euint64,
    euint256,
    ebool,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IJobManager} from "./IJobManager.sol";
import {IDatasetRegistry} from "./IDatasetRegistry.sol";
import {RowDecoder} from "./RowDecoder.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";


contract JobManager is IJobManager, SepoliaConfig, ReentrancyGuard, Ownable {
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

    // Payment constants
    uint256 public constant STALL_TIMEOUT = 24 hours;

    // ========================================
    // DEPENDENCIES
    // ========================================

    IDatasetRegistry public immutable DATASET_REGISTRY;

    // ========================================
    // STRUCTS AND ENUMS
    // ========================================

    struct JobState {
        euint64 agg; // sum / weighted_sum accumulator
        euint64 minV;
        euint64 maxV;
        euint32 kept; // encrypted counter of kept rows
        ebool minMaxInit;
        ebool isOverflow;
    }

    // ========================================
    // STATE VARIABLES
    // ========================================

    constructor(address datasetRegistry) Ownable(msg.sender) {
        DATASET_REGISTRY = IDatasetRegistry(datasetRegistry);
        _nextJobId = 1;
        _nextRequestId = 1;
    }

    // Payment management
    uint256 public paymentThreshold = 0.05 ether;

    uint256 private _nextJobId;
    mapping(uint256 jobId => Job job) private _jobs;

    // Job state accumulators
    mapping(uint256 jobId => JobState jobState) private _state;

    // Cooldown tracking: keccak(buyer,datasetId) -> last finalize timestamp
    mapping(bytes32 key => uint64 timestamp) private _lastUse;

    // Merkle proof verification: track last processed row per job (enforce ascending order)
    mapping(uint256 jobId => uint256 lastRowIndex) private _jobLastProcessedRow;

    // Request management
    uint256 private _nextRequestId;
    mapping(uint256 requestId => JobRequest) private _requests;
    mapping(uint256 datasetId => uint256[]) private _datasetRequests; // For dataset owner lookup
    mapping(uint256 jobId => uint256 requestId) private _jobToRequest; // Reverse lookup

    // ========================================
    // VIEW FUNCTIONS
    // ========================================

    function nextJobId() external view returns (uint256) {
        return _nextJobId;
    }

    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    function jobBuyer(uint256 jobId) external view returns (address) {
        return _jobs[jobId].buyer;
    }

    function jobOpen(uint256 jobId) external view returns (bool) {
        return !_jobs[jobId].isFinalized;
    }

    function jobDataset(uint256 jobId) external view returns (uint256) {
        return _jobs[jobId].datasetId;
    }

    function getJobProgress(uint256 jobId) external view returns (
        uint256 totalRows,
        uint256 processedRows,
        uint256 remainingRows
    ) {
        Job storage job = _jobs[jobId];
        totalRows = job.rowCount;
        
        // _jobLastProcessedRow stores last processed index
        // If it's type(uint256).max, no rows processed yet
        if (_jobLastProcessedRow[jobId] == type(uint256).max) {
            processedRows = 0;
        } else {
            processedRows = _jobLastProcessedRow[jobId] + 1; // +1 because it's 0-indexed
        }
        
        remainingRows = totalRows - processedRows;
    }

    function getJobResult(uint256 jobId) external view returns (
        bool isFinalized,
        euint256 result,
        ebool isOverflow
    ) {
        Job storage job = _jobs[jobId];
        
        // Job must be finalized to have a result
        if (!job.isFinalized) {
            revert JobNotFinalized();
        }
        
        return (job.isFinalized, job.result, _state[jobId].isOverflow);
    }

    // ========================================
    // JOB LIFECYCLE FUNCTIONS
    // ========================================
    function openJob(
        uint256 datasetId,
        address buyer,
        JobParams calldata params
    ) external returns (uint256 jobId) {
        jobId = _createJob(datasetId, buyer, params);
        emit JobOpened(jobId, datasetId, msg.sender);
    }

    function _createJob(
        uint256 datasetId,
        address buyer,
        JobParams memory params
    ) internal returns (uint256 jobId) {
        // Orchestrator function - delegates to smaller helper functions
        _validateDatasetAccess(datasetId);

        // Fetch dataset info once for gas optimization
        (bytes32 merkleRoot, uint256 numColumns, uint256 rowCount, , , euint32 kAnonymity, uint32 cooldownSec) =
            DATASET_REGISTRY.getDataset(datasetId);

        _validateJobParameters(params, numColumns);
        _checkCooldownPeriod(buyer, datasetId, cooldownSec);
        jobId = _initializeJobState(datasetId, buyer, params, merkleRoot, rowCount, cooldownSec, kAnonymity);
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
    /// @param params The job parameters to validate
    /// @param numColumns The number of columns in the dataset
    function _validateJobParameters(JobParams memory params, uint256 numColumns) internal pure {
        // Validate divisor for AVG_P operation
        if (params.op == Op.AVG_P && params.divisor == 0) {
            revert CannotDivideByZero();
        }

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
    /// @param cooldownSec The cooldown period in seconds
    function _checkCooldownPeriod(address buyer, uint256 datasetId, uint32 cooldownSec) internal view {
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
    /// @param merkleRoot The dataset merkle root
    /// @param rowCount The dataset row count
    /// @param cooldownSec The dataset cooldown period
    /// @param kAnonymity The dataset k-anonymity requirement (encrypted)
    /// @return jobId The assigned job ID
    function _initializeJobState(
        uint256 datasetId,
        address buyer,
        JobParams memory params,
        bytes32 merkleRoot,
        uint256 rowCount,
        uint32 cooldownSec,
        euint32 kAnonymity
    ) internal returns (uint256 jobId) {
        euint64 initValue64 = FHE.asEuint64(0);
        euint256 initValue256 = FHE.asEuint256(0);
        ebool initMinMaxInit = FHE.asEbool(false);

        jobId = _nextJobId++;
        _jobs[jobId] = Job({
            params: params,
            buyer: buyer,
            datasetId: datasetId,
            isFinalized: false,
            result: initValue256,
            merkleRoot: merkleRoot,
            rowCount: rowCount,
            cooldownSec: cooldownSec,
            kAnonymity: kAnonymity
        });

        _jobLastProcessedRow[jobId] = type(uint256).max; // Initialize to max to indicate no rows processed yet

        // Initialize job state with provided initial value
        _state[jobId] = JobState({
            agg: initValue64,
            minV: initValue64,
            maxV: initValue64,
            kept: FHE.asEuint32(initValue64),
            minMaxInit: initMinMaxInit,
            isOverflow: FHE.asEbool(false)
        });

        FHE.allowThis(initValue64);
        FHE.allowThis(initValue256);
        FHE.allowThis(_state[jobId].kept);
        FHE.allowThis(initMinMaxInit);
        FHE.allowThis(_state[jobId].isOverflow);
    }

    function _isJobBuyer(uint256 jobId) internal view returns (bool) {
        return _jobs[jobId].buyer == msg.sender;
    }

    function _isDatasetOwner(uint256 datasetId) internal view returns (bool) {
        return DATASET_REGISTRY.isDatasetOwner(datasetId, msg.sender);
    }

    function _isJobOpen(uint256 jobId) internal view returns (bool) {
        return !_jobs[jobId].isFinalized;
    }

    function pushRow(
        uint256 jobId,
        bytes calldata rowPacked,
        bytes32[] calldata merkleProof,
        uint256 rowIndex
    ) external {
        uint256 gasBefore = gasleft();
        
        // Orchestrator function - delegates to smaller helper functions
        // Fetch storage pointer once for gas efficiency
        Job storage job = _jobs[jobId];

        _validateRowProcessing(job, jobId, rowIndex);
        _verifyRowIntegrity(job, jobId, rowPacked, merkleProof, rowIndex);
        _processRowData(job, jobId, rowPacked);

        // Track gas if this job is from a request
        uint256 requestId = _jobToRequest[jobId];
        if (_requests[requestId].jobId == jobId) {
            _trackGasAndMaybePayout(requestId, gasBefore);
        }

        emit RowPushed(jobId);
    }

    /// @notice Validates job state and row processing order
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @param rowIndex The row index being processed
    function _validateRowProcessing(Job storage job, uint256 jobId, uint256 rowIndex) internal view {
        // Basic job validation
        if (job.isFinalized) {
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

        // Use cached merkle root for gas optimization
        bytes32 merkleRoot = job.merkleRoot;

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

    function finalize(uint256 jobId) external nonReentrant {
        uint256 gasBefore = gasleft();
        
        // Orchestrator function - delegates to smaller helper functions
        // Fetch storage pointer once for gas efficiency
        Job storage job = _jobs[jobId];

        _validateFinalization(job, jobId);

        ebool isOverflow = _state[jobId].isOverflow;

        euint256 result = _computeJobResult(job, jobId);
        _finalizeJobState(job, result, isOverflow);

        // Handle request-based job payment settlement
        uint256 requestId = _jobToRequest[jobId];
        if (_requests[requestId].jobId == jobId) {
            JobRequest storage request = _requests[requestId];
            _trackGasAndMaybePayout(requestId, gasBefore);
            
            // Final settlement: pay all remaining amounts
            uint256 sellerPayout = request.gasDebtToSeller + request.baseFee;
            uint256 buyerRefund = request.computeAllowance;
            request.gasDebtToSeller = 0;
            request.baseFee = 0;
            request.computeAllowance = 0;
            request.status = RequestStatus.COMPLETED;
            
            if (sellerPayout > 0) {
                (, , , address seller, , , ) = DATASET_REGISTRY.getDataset(request.datasetId);
                (bool s1, ) = payable(seller).call{value: sellerPayout}("");
                if (!s1) revert PaymentFailed();
            }
            if (buyerRefund > 0) {
                (bool s2, ) = payable(request.buyer).call{value: buyerRefund}("");
                if (!s2) revert PaymentFailed();
            }
            
            emit RequestCompleted(requestId, jobId);
        }

        emit JobFinalized(jobId, job.buyer, result, isOverflow);
    }

    // ========================================
    // REQUEST LIFECYCLE FUNCTIONS
    // ========================================

    function submitRequest(uint256 datasetId, JobParams calldata params, uint256 baseFee) 
        external 
        payable 
        returns (uint256 requestId) 
    {
        if (!DATASET_REGISTRY.doesDatasetExist(datasetId)) {
            revert DatasetNotFound();
        }

        if (msg.value < baseFee) {
            revert InsufficientPayment();
        }

        // Validate params early to avoid wasting gas on invalid requests
        (, uint256 numColumns, , , , , ) = DATASET_REGISTRY.getDataset(datasetId);
        _validateJobParameters(params, numColumns);

        requestId = _nextRequestId++;
        _requests[requestId] = JobRequest({
            datasetId: datasetId,
            buyer: msg.sender,
            params: params,
            status: RequestStatus.PENDING,
            timestamp: block.timestamp,
            jobId: 0,
            baseFee: baseFee,
            computeAllowance: msg.value - baseFee,
            gasDebtToSeller: 0
        });

        _datasetRequests[datasetId].push(requestId);
        emit RequestSubmitted(requestId, datasetId, msg.sender);
    }

    function acceptRequest(uint256 requestId) external nonReentrant returns (uint256 jobId) {
        uint256 gasBefore = gasleft();
        JobRequest storage request = _requests[requestId];

        if (request.status != RequestStatus.PENDING) {
            revert RequestNotPending();
        }

        // Base fee is held in escrow until job completion (paid in finalize)
        
        // Create job using internal logic. _createJob handles ownership check.
        JobParams memory params = request.params;
        jobId = _createJob(request.datasetId, request.buyer, params);

        // Update request state
        request.status = RequestStatus.ACCEPTED;
        request.jobId = jobId;
        request.timestamp = block.timestamp; // Reset for stall detection

        // Create reverse mapping for finalization lookup
        _jobToRequest[jobId] = requestId;

        // Track gas for acceptRequest operation
        _trackGasAndMaybePayout(requestId, gasBefore);

        emit RequestAccepted(requestId, jobId);
    }

    function rejectRequest(uint256 requestId) external nonReentrant {
        JobRequest storage request = _requests[requestId];

        if (request.status != RequestStatus.PENDING) {
            revert RequestNotPending();
        }

        if (!_isDatasetOwner(request.datasetId)) {
            revert NotDatasetOwner();
        }

        // Refund full amount to buyer on rejection
        uint256 totalRefund = request.baseFee + request.computeAllowance;
        request.status = RequestStatus.REJECTED;

        if (totalRefund > 0) {
            (bool success, ) = payable(request.buyer).call{value: totalRefund}("");
            if (!success) {
                revert PaymentFailed();
            }
        }

        emit RequestRejected(requestId);
    }

    function cancelRequest(uint256 requestId) external nonReentrant {
        JobRequest storage request = _requests[requestId];

        if (request.status != RequestStatus.PENDING) {
            revert RequestNotPending();
        }

        if (request.buyer != msg.sender) {
            revert NotRequestBuyer();
        }

        // Full refund for pending requests
        uint256 totalRefund = request.baseFee + request.computeAllowance;
        request.status = RequestStatus.REJECTED; // Reuse REJECTED for cancelled

        if (totalRefund > 0) {
            (bool success, ) = payable(msg.sender).call{value: totalRefund}("");
            if (!success) {
                revert PaymentFailed();
            }
        }

        emit RequestCancelled(requestId);
    }

    function reclaimStalled(uint256 requestId) external nonReentrant {
        JobRequest storage request = _requests[requestId];

        if (msg.sender != request.buyer) {
            revert NotRequestBuyer();
        }

        if (request.status != RequestStatus.ACCEPTED) {
            revert RequestNotPending();
        }

        if (block.timestamp <= request.timestamp + STALL_TIMEOUT) {
            revert NotStalled();
        }

        // Pay seller any earned debt for work done
        if (request.gasDebtToSeller > 0) {
            _payoutSeller(requestId);
        }

        // Refund remaining allowance + base fee to buyer (job incomplete)
        uint256 refund = request.computeAllowance + request.baseFee;
        request.computeAllowance = 0;
        request.baseFee = 0;
        request.status = RequestStatus.REJECTED; // Mark terminated

        if (refund > 0) {
            (bool success, ) = payable(request.buyer).call{value: refund}("");
            if (!success) {
                revert PaymentFailed();
            }
        }

        emit RequestStalled(requestId);
    }

    function requestPayout(uint256 requestId) external {
        JobRequest storage request = _requests[requestId];
        
        if (!_isDatasetOwner(request.datasetId)) {
            revert NotDatasetOwner();
        }

        if (request.status != RequestStatus.ACCEPTED) {
            revert RequestNotPending();
        }

        _payoutSeller(requestId);
    }

    function topUpAllowance(uint256 requestId) external payable {
        JobRequest storage request = _requests[requestId];

        if (msg.sender != request.buyer) {
            revert NotRequestBuyer();
        }

        if (request.status != RequestStatus.ACCEPTED) {
            revert RequestNotPending();
        }

        request.computeAllowance += msg.value;
        emit AllowanceToppedUp(requestId, msg.value);
    }

    function setPaymentThreshold(uint256 newThreshold) external onlyOwner {
        paymentThreshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    // ========================================
    // REQUEST VIEW FUNCTIONS
    // ========================================

    function getRequest(uint256 requestId) external view returns (JobRequest memory) {
        return _requests[requestId];
    }

    /// @notice Validates that job can be finalized (open and all rows processed)
    /// @param job The storage pointer to the job to validate
    /// @param jobId The job ID
    function _validateFinalization(Job storage job, uint256 jobId) internal view {
        if (job.isFinalized) {
            revert JobClosed();
        }

        // Validate that all rows have been processed
        uint256 rowCount = job.rowCount;

        if (_jobLastProcessedRow[jobId] != rowCount - 1) {
            revert IncompleteProcessing();
        }
    }

    /// @notice Computes the final result based on operation type
    /// @param job The storage pointer to the job
    /// @param jobId The job ID
    /// @return result The computed encrypted result
    function _computeJobResult(Job storage job, uint256 jobId) internal returns (euint256 result) {
        JobParams memory params = job.params;
        JobState memory state = _state[jobId];

        // Compute the actual result based on operation type
        euint64 actualResult;
        if (params.op == Op.COUNT) {
            actualResult = FHE.asEuint64(state.kept);
        } else if (params.op == Op.SUM) {
            actualResult = state.agg; // Return the accumulated sum
        } else if (params.op == Op.AVG_P) {
            // Apply divisor to get average
            actualResult = FHE.div(state.agg, params.divisor);
        } else if (params.op == Op.WEIGHTED_SUM) {
            actualResult = state.agg; // Return the accumulated weighted sum
        } else if (params.op == Op.MIN) {
            actualResult = state.minV; // Return the minimum value
        } else if (params.op == Op.MAX) {
            actualResult = state.maxV; // Return the maximum value
        } else {
            actualResult = FHE.asEuint64(0); // placeholder for unimplemented ops
        }

        // Apply post-processing transformations (clamp, roundBucket) before k-anonymity check
        euint64 processedResult = actualResult;
        if (params.clampMin > 0 || params.clampMax > 0) {
            processedResult = _clamp(processedResult, params.clampMin, params.clampMax);
        }
        if (params.roundBucket > 0) {
            processedResult = _roundBucket(processedResult, params.roundBucket);
        }

        // Apply k-anonymity privacy protection
        // Check if k-anonymity requirement is met
        ebool meetsAnonymity = FHE.ge(state.kept, job.kAnonymity);

        // Define a sentinel value to indicate k-anonymity failure.
        // Use uint128.max as sentinel to avoid ambiguity with valid uint64 results
        euint256 failureValue = FHE.asEuint256(type(uint128).max);

        // Return actual result if k-anonymity is met, otherwise return the failure sentinel value
        result = FHE.select(meetsAnonymity, FHE.asEuint256(processedResult), failureValue);
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
    }

    /// @notice Finalizes job state and handles cooldown
    /// @param job The storage pointer to the job
    /// @param result The final result
    function _finalizeJobState(Job storage job, euint256 result, ebool isOverflow) internal {
        uint256 datasetId = job.datasetId;
        address buyer = job.buyer;

        // Update job state
        job.isFinalized = true;
        job.result = result;

        // Set FHE permissions
        FHE.allowThis(result);
        FHE.allow(result, buyer);
        FHE.allow(isOverflow, buyer);

        // Handle cooldown
        uint32 cooldownSec = job.cooldownSec;
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
        // Always update the kept counter for k-anonymity checks
        euint32 increment = FHE.select(keep, FHE.asEuint32(1), FHE.asEuint32(0));
        _state[jobId].kept = FHE.add(_state[jobId].kept, increment);
        FHE.allowThis(_state[jobId].kept);

        if (params.op == Op.COUNT) {
            // For COUNT, the "kept" counter is the result, so no other accumulation is needed.
        } else if (params.op == Op.SUM || params.op == Op.AVG_P) {
            // SUM and AVG_P: add target field value when filter passes
            euint64 targetValue = fields[params.targetField];
            euint64 valueToAdd = FHE.select(keep, targetValue, FHE.asEuint64(0));
            euint64 currentAgg = _state[jobId].agg;
            euint64 nextAgg = FHE.add(currentAgg, valueToAdd);

            ebool isOverflow = FHE.lt(nextAgg, currentAgg);
            _state[jobId].isOverflow = FHE.or(_state[jobId].isOverflow, isOverflow);
            _state[jobId].agg = nextAgg;

            FHE.allowThis(_state[jobId].agg);
            FHE.allowThis(_state[jobId].isOverflow);
        } else if (params.op == Op.WEIGHTED_SUM) {
            // WEIGHTED_SUM: compute weighted sum of fields using sequential indices when filter passes
            euint64 weightedSum = FHE.asEuint64(0);
            ebool isOverflow = FHE.asEbool(false);

            for (uint256 i = 0; i < params.weights.length; i++) {
                uint16 weight = params.weights[i];
                euint64 fieldValue = fields[i];

                euint64 weightedValue = FHE.mul(fieldValue, uint64(weight));

                // Multiplication overflow check: if fieldValue > 0 and weight > 0, then weightedValue / weight should be fieldValue
                ebool mulOverflow = FHE.and(
                    FHE.gt(fieldValue, 0),
                    FHE.select(
                        FHE.asEbool(weight > 0),
                        FHE.ne(FHE.div(weightedValue, uint64(weight)), fieldValue),
                        FHE.asEbool(false)
                    )
                );

                isOverflow = FHE.or(isOverflow, mulOverflow);

                euint64 nextSum = FHE.add(weightedSum, weightedValue);
                ebool addOverflow = FHE.lt(nextSum, weightedSum);

                isOverflow = FHE.or(isOverflow, addOverflow);
                weightedSum = nextSum;
            }

            // Add weighted sum to accumulator when filter passes
            euint64 valueToAdd = FHE.select(keep, weightedSum, FHE.asEuint64(0));
            euint64 currentAgg = _state[jobId].agg;
            euint64 nextAgg = FHE.add(currentAgg, valueToAdd);

            ebool finalAddOverflow = FHE.lt(nextAgg, currentAgg);
            isOverflow = FHE.or(isOverflow, finalAddOverflow);

            _state[jobId].isOverflow = FHE.or(_state[jobId].isOverflow, FHE.select(keep, isOverflow, FHE.asEbool(false)));
            _state[jobId].agg = nextAgg;

            FHE.allowThis(_state[jobId].agg);
            FHE.allowThis(_state[jobId].isOverflow);
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

    // ---- Payment Helpers ----
    /// @notice Tracks gas usage and maybe pays out seller if threshold reached
    /// @param requestId The request ID
    /// @param gasBefore The gas before the operation
    function _trackGasAndMaybePayout(uint256 requestId, uint256 gasBefore) internal {
        JobRequest storage request = _requests[requestId];
        
        uint256 gasUsed = gasBefore - gasleft();
        uint256 cost = gasUsed * tx.gasprice;
        
        // STRICT: Must have sufficient allowance to pay for work
        if (cost > request.computeAllowance) {
            revert InsufficientAllowance();
        }
        
        // Accumulate debt
        request.computeAllowance -= cost;
        request.gasDebtToSeller += cost;
        
        // Auto-payout if threshold reached
        if (request.gasDebtToSeller >= paymentThreshold) {
            _payoutSeller(requestId);
        }
    }

    /// @notice Pays out accumulated gas debt to seller
    /// @param requestId The request ID
    function _payoutSeller(uint256 requestId) internal {
        JobRequest storage request = _requests[requestId];
        uint256 debt = request.gasDebtToSeller;
        
        if (debt == 0) return;
        
        request.gasDebtToSeller = 0;
        
        // Get dataset owner
        (, , , address seller, , , ) = DATASET_REGISTRY.getDataset(request.datasetId);
        (bool success, ) = payable(seller).call{value: debt}("");
        
        if (!success) {
            // Restore debt if payment fails
            request.gasDebtToSeller = debt;
            revert PaymentFailed();
        }

        emit SellerPaid(requestId, seller, debt);
    }
}
