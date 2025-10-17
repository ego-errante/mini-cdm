// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32, externalEuint8, externalEuint64, euint64, euint256, ebool} from "@fhevm/solidity/lib/FHE.sol";
import "./IDatasetRegistry.sol";

interface IJobManager {
    // ---- enums (v1 ops & fields) ----
    enum Op {
        WEIGHTED_SUM,
        SUM,
        AVG_P,
        COUNT,
        MIN,
        MAX
    }

    // ---- tiny filter VM (field refs by index) ----
    struct FilterProg {
        bytes bytecode; // opcodes use uint16 field indices where needed
        uint256[] consts; // plaintext constants
    }

    // ---- job params (schema-agnostic) ----
    struct JobParams {
        Op op;
        uint16 targetField; // for SUM/AVG_P/MIN/MAX; ignored for WEIGHTED_SUM
        uint16[] weights; // weights for WEIGHTED_SUM (weights[i] applies to field i)
        uint32 divisor; // plaintext divisor (0 if unused)
        uint64 clampMin; // 0 if unused
        uint64 clampMax; // 0 if unused
        uint32 roundBucket; // 0 if unused
        FilterProg filter; // boolean tree as bytecode
    }

    // ---- request lifecycle ----
    enum RequestStatus {
        PENDING,
        ACCEPTED,
        REJECTED,
        COMPLETED
    }

    struct JobRequest {
        uint256 datasetId;
        address buyer;
        JobParams params;
        RequestStatus status;
        uint256 timestamp;
        uint256 jobId;
        uint256 baseFee;
        uint256 computeAllowance;
        uint256 gasDebtToSeller;
    }

    // ---- views ----
    function nextJobId() external view returns (uint256);
    function nextRequestId() external view returns (uint256);

    function jobBuyer(uint256 jobId) external view returns (address);

    function jobOpen(uint256 jobId) external view returns (bool);

    function jobDataset(uint256 jobId) external view returns (uint256);

    // ---- request views ----
    function getRequest(uint256 requestId) external view returns (JobRequest memory);
    function getBuyerRequests(address buyer, uint256 datasetId) external view returns (uint256[] memory);
    function getPendingRequestsForDataset(uint256 datasetId) external view returns (uint256[] memory);


    // ---- lifecycle ----
    function openJob(uint256 datasetId, address buyer, JobParams calldata params) external returns (uint256 jobId);

    /// @notice `rowPacked` is ABI-encoded per dataset schema:
    ///         a sequence of (typeTag | external ciphertext | proof) for each field.
    ///         The JobManager (or dataset adapter) decodes by schema to cast into euintXs.
    /// @param merkleProof Array of proof elements for merkle inclusion verification
    /// @param rowIndex Position of this row in the dataset (0-based)
    function pushRow(
        uint256 jobId,
        bytes calldata rowPacked,
        bytes32[] calldata merkleProof,
        uint256 rowIndex
    ) external;

    function finalize(uint256 jobId) external; // sealed; decryption allowed only if policy passes

    // ---- request lifecycle ----
    function submitRequest(uint256 datasetId, JobParams calldata params, uint256 baseFee) external payable returns (uint256 requestId);
    function acceptRequest(uint256 requestId) external returns (uint256 jobId);
    function rejectRequest(uint256 requestId) external;
    function cancelRequest(uint256 requestId) external;
    function reclaimStalled(uint256 requestId) external;
    function requestPayout(uint256 requestId) external;
    function topUpAllowance(uint256 requestId) external payable;
    function setPaymentThreshold(uint256 newThreshold) external;

    // ---- events ----
    event JobOpened(uint256 indexed jobId, uint256 indexed datasetId, address indexed buyer);
    event RowPushed(uint256 indexed jobId);
    event JobFinalized(uint256 indexed jobId, address indexed buyer, euint256 result, ebool isOverflow);
    event RequestSubmitted(uint256 indexed requestId, uint256 indexed datasetId, address indexed buyer);
    event RequestAccepted(uint256 indexed requestId, uint256 indexed jobId);
    event RequestRejected(uint256 indexed requestId);
    event RequestCompleted(uint256 indexed requestId, uint256 indexed jobId);
    event RequestCancelled(uint256 indexed requestId);
    event RequestStalled(uint256 indexed requestId);
    event SellerPaid(uint256 indexed requestId, address indexed seller, uint256 amount);
    event AllowanceToppedUp(uint256 indexed requestId, uint256 amount);
    event ThresholdUpdated(uint256 newThreshold);

    // ---- errors ----
    error JobClosed();
    error CooldownActive();
    error KAnonymityNotMet();
    error NotJobBuyer();
    error NotDatasetOwner();
    error DatasetNotFound();
    error InvalidMerkleProof();
    error RowOutOfOrder();
    error MerkleVerificationFailed();
    error InvalidRowSchema();
    error IncompleteProcessing();
    error CannotDivideByZero();
    error WeightsLengthMismatch();
    error InvalidFieldIndex();
    error InvalidClampRange();
    error FilterBytecodeTooLong();
    error FilterConstsTooLong();

    // ---- request errors ----
    error RequestNotPending();
    error NotRequestBuyer();
    error InsufficientPayment();
    error InsufficientAllowance();
    error PaymentFailed();
    error NotAuthorized();
    error NotStalled();

    // Filter VM errors
    error FilterVMUnknownOpcode(uint8 opcode);
    error FilterVMInsufficientBytecode();
    error FilterVMInvalidFieldIndex();
    error FilterVMInvalidConstantIndex();
    error FilterVMStackOverflow(string stackName);
    error FilterVMStackUnderflow(string stackName);
    error FilterVMInvalidFinalStackState();
    error FilterVMStackNotEmpty(string stackName);

}
