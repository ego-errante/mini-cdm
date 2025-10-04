// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint32, externalEuint32, externalEuint8, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
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
        uint16[] weightFieldIdx; // sparse indices for WEIGHTED_SUM (e.g., [0,2,5])
        int16[] weightVals; // matching weights (e.g., [1,-1,3])
        uint32 divisor; // plaintext divisor (0 if unused)
        uint32 k; // k-anonymity threshold
        uint32 cooldownSec; // per (buyer,dataset) cooldown
        uint64 clampMin; // 0 if unused
        uint64 clampMax; // 0 if unused
        uint32 roundBucket; // 0 if unused
        FilterProg filter; // boolean tree as bytecode
    }

    // ---- views ----
    function nextJobId() external view returns (uint256);

    function jobBuyer(uint256 jobId) external view returns (address);

    function jobOpen(uint256 jobId) external view returns (bool);

    function jobDataset(uint256 jobId) external view returns (uint256);

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

    function finalize(uint256 jobId) external returns (euint64 result); // sealed; decryption allowed only if policy passes

    // ---- events ----
    event JobOpened(uint256 indexed jobId, uint256 indexed datasetId, address indexed buyer);
    event RowPushed(uint256 indexed jobId);
    event JobFinalized(uint256 indexed jobId, address indexed buyer);

    // ---- errors ----
    error JobClosed();
    error CooldownActive();
    error KAnonymityNotMet();
    error NotJobBuyer();
    error NotDatasetOwner();
    error WeightsLengthMismatch(); // weightFieldIdx.length != weightVals.length
    error DatasetNotFound();
    error InvalidMerkleProof();
    error RowOutOfOrder();
    error MerkleVerificationFailed();
    error InvalidRowSchema();
    error IncompleteProcessing();
}
