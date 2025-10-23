# Smart Contracts Reference

Comprehensive reference guide for Mini-DCM's smart contracts, including detailed API documentation, operation specifications, and privacy features.

## Table of Contents

- [Contract Overview](#contract-overview)
- [DatasetRegistry](#datasetregistry)
- [JobManager](#jobmanager)
- [RowDecoder Library](#rowdecoder-library)
- [Supported Operations](#supported-operations)
- [Post-Processing](#post-processing)
- [Privacy Features](#privacy-features)
- [Events Reference](#events-reference)
- [Errors Reference](#errors-reference)

## Contract Overview

### Contract Addresses

Deployment addresses are network-specific and generated during deployment:

```typescript
// packages/site/abi/DatasetRegistryAddresses.ts
export const DatasetRegistryAddresses = {
  localhost: "0x...", // Local Hardhat
  sepolia: "0x...", // Sepolia Testnet
};

// packages/site/abi/JobManagerAddresses.ts
export const JobManagerAddresses = {
  localhost: "0x...",
  sepolia: "0x...",
};
```

### Deployment Order

1. **DatasetRegistry** (deployed first)
2. **JobManager** (requires DatasetRegistry address)
3. **Configuration** (`DatasetRegistry.setJobManager()`)

## DatasetRegistry

**Purpose**: Manages dataset metadata, ownership, and enumeration.

**Inheritance**: `Ownable`, `SepoliaConfig`

### State Variables

```solidity
mapping(uint256 => Dataset) private _datasets;
uint256[] private _datasetIds;
mapping(uint256 => uint256) private _datasetIdToIndex;
address private _jobManager;
```

### Structures

#### Dataset

```solidity
struct Dataset {
    bytes32 merkleRoot;      // Root hash of Merkle tree
    uint256 numColumns;      // Number of fields per row
    uint256 rowCount;        // Total rows in dataset
    address owner;           // Dataset owner address
    bool exists;             // Existence flag
    euint32 kAnonymity;      // Min anonymity set size (encrypted)
    uint32 cooldownSec;      // Cooldown period (seconds)
}
```

### Core Functions

#### commitDataset

Register a new dataset with encrypted k-anonymity parameter.

```solidity
function commitDataset(
    uint256 datasetId,
    uint256 rowCount,
    bytes32 merkleRoot,
    uint256 numColumns,
    externalEuint32 kAnonymity,
    bytes calldata inputProof,
    uint32 cooldownSec
) external
```

**Parameters**:

- `datasetId`: Unique identifier chosen by seller
- `rowCount`: Total number of rows (must be > 0, ≤ uint64.max)
- `merkleRoot`: Root hash of Merkle tree covering all rows
- `numColumns`: Number of fields per row (must be > 0)
- `kAnonymity`: Encrypted minimum result set size
- `inputProof`: Zero-knowledge proof for kAnonymity
- `cooldownSec`: Seconds between queries (0 = no cooldown)

**Emits**: `DatasetCommitted`

**Example**:

```typescript
import { createInstance } from "@fhevm/react";

// Encrypt k-anonymity value
const fhevmInstance = await createInstance({ chainId, provider });
const encryptedK = await fhevmInstance.createEncryptedInput(
  registryAddress,
  accounts[0]
);
encryptedK.add32(5); // k = 5
const { handles, inputProof } = await encryptedK.encrypt();

// Commit dataset
const tx = await datasetRegistry.commitDataset(
  datasetId,
  rowCount,
  merkleRoot,
  numColumns,
  handles[0], // encrypted kAnonymity
  inputProof,
  3600 // 1 hour cooldown
);
await tx.wait();
```

#### deleteDataset

Remove a dataset (owner only).

```solidity
function deleteDataset(uint256 datasetId) external
```

**Reverts**:

- `DatasetNotFound`: Dataset doesn't exist
- `NotDatasetOwner`: Caller is not the owner

**Emits**: `DatasetDeleted`

#### getDataset

Retrieve dataset metadata.

```solidity
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
    )
```

#### View Functions

```solidity
// Check if dataset exists
function doesDatasetExist(uint256 datasetId) external view returns (bool);

// Check if address is dataset owner
function isDatasetOwner(uint256 datasetId, address account)
    external view returns (bool);

// Validate row schema
function isRowSchemaValid(uint256 datasetId, uint256 fieldCount)
    external view returns (bool);

// Enumeration
function getDatasetCount() external view returns (uint256);
function getAllDatasetIds() external view returns (uint256[] memory);
function getAllDatasets() external view returns (DatasetWithId[] memory);
function getDatasets(uint256 offset, uint256 limit)
    external view returns (DatasetWithId[] memory);
```

### Administration

#### setJobManager

Configure the JobManager contract address (owner only).

```solidity
function setJobManager(address jobManager) external onlyOwner
```

**Must be called before any datasets can be committed.**

## JobManager

**Purpose**: Orchestrates job execution, manages requests, handles payments, and enforces privacy guarantees.

**Inheritance**: `ReentrancyGuard`, `Ownable`, `SepoliaConfig`

### State Variables

```solidity
uint256 private _nextJobId;
uint256 private _nextRequestId;
mapping(uint256 => Job) private _jobs;
mapping(uint256 => JobState) private _state;
mapping(uint256 => JobRequest) private _requests;
mapping(uint256 => uint256) private _jobToRequest;
mapping(uint256 => uint256) private _jobLastProcessedRow;
mapping(bytes32 => uint64) private _lastUse;  // Cooldown tracking
uint256 public paymentThreshold = 0.05 ether;
```

### Structures

#### JobParams

```solidity
struct JobParams {
    Op op;                   // Operation type
    uint16 targetField;      // Column for SUM/AVG/MIN/MAX (0-indexed)
    uint16[] weights;        // Weights for WEIGHTED_SUM
    uint32 divisor;          // Plaintext divisor for AVG_P
    uint64 clampMin;         // Minimum clamp value (0 = disabled)
    uint64 clampMax;         // Maximum clamp value (0 = disabled)
    uint32 roundBucket;      // Bucket size for rounding (0 = disabled)
    FilterProg filter;       // Filter bytecode program
}
```

#### Op (Enum)

```solidity
enum Op {
    WEIGHTED_SUM,  // Σ(weights[i] * fields[i])
    SUM,           // Σ(field[targetField])
    AVG_P,         // Σ(field[targetField]) / divisor
    COUNT,         // Count of kept rows
    MIN,           // min(field[targetField])
    MAX            // max(field[targetField])
}
```

#### FilterProg

```solidity
struct FilterProg {
    bytes bytecode;      // VM bytecode (max 512 bytes)
    uint256[] consts;    // Plaintext constants (max 64)
}
```

#### Job

```solidity
struct Job {
    JobParams params;
    address buyer;
    uint256 datasetId;
    bool isFinalized;
    euint256 result;
    bytes32 merkleRoot;    // Cached from dataset
    uint256 rowCount;      // Cached from dataset
    uint32 cooldownSec;    // Cached from dataset
    euint32 kAnonymity;    // Cached from dataset
}
```

#### JobRequest

```solidity
struct JobRequest {
    uint256 datasetId;
    address buyer;
    JobParams params;
    RequestStatus status;
    uint256 timestamp;
    uint256 jobId;
    uint256 baseFee;           // Fixed fee for seller
    uint256 computeAllowance;  // Gas budget
    uint256 gasDebtToSeller;   // Accumulated debt
}
```

#### RequestStatus (Enum)

```solidity
enum RequestStatus {
    PENDING,    // Submitted, awaiting seller action
    ACCEPTED,   // Seller accepted, job in progress
    REJECTED,   // Seller rejected or buyer cancelled
    COMPLETED   // Job finalized, payments settled
}
```

### Job Lifecycle Functions

#### openJob

Create a job directly (dataset owner only).

```solidity
function openJob(
    uint256 datasetId,
    address buyer,
    JobParams calldata params
) external returns (uint256 jobId)
```

**Validation**:

- Dataset must exist
- Caller must be dataset owner
- Parameters must be valid for dataset schema
- Cooldown period must be satisfied

**Returns**: Newly created job ID

**Emits**: `JobOpened`

**Example**:

```typescript
const jobParams = {
  op: 3, // COUNT
  targetField: 0,
  weights: [],
  divisor: 0,
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: {
    bytecode: "0x01000000020000010", // field[0] > 100
    consts: [100n],
  },
};

const tx = await jobManager.openJob(datasetId, buyerAddress, jobParams);
const receipt = await tx.wait();
const jobId = receipt.events[0].args.jobId;
```

#### pushRow

Process a single encrypted row with Merkle proof.

```solidity
function pushRow(
    uint256 jobId,
    bytes calldata rowPacked,
    bytes32[] calldata merkleProof,
    uint256 rowIndex
) external
```

**Parameters**:

- `jobId`: Job identifier
- `rowPacked`: Encrypted row data (see [RowDecoder](#rowdecoder-library))
- `merkleProof`: Array of sibling hashes for verification
- `rowIndex`: 0-indexed position in dataset

**Validation**:

- Job must be open (not finalized)
- Rows must be processed sequentially (rowIndex = last + 1)
- Caller must be dataset owner
- Merkle proof must be valid

**Execution**:

1. Verify Merkle proof
2. Decode encrypted row
3. Evaluate filter
4. Update accumulators
5. Track gas (if request-based)

**Emits**: `RowPushed`

**Example**:

```typescript
// For each row in dataset
for (let i = 0; i < dataset.rowCount; i++) {
  const rowPacked = dataset.rows[i];
  const merkleProof = dataset.proofs[i];

  const tx = await jobManager.pushRow(jobId, rowPacked, merkleProof, i);
  await tx.wait();
}
```

#### finalize

Complete job and release encrypted result.

```solidity
function finalize(uint256 jobId) external nonReentrant
```

**Validation**:

- Job must be open
- All rows must be processed
- Caller must be dataset owner (or anyone for request-based)

**Execution**:

1. Compute result based on operation type
2. Apply post-processing (clamp, round)
3. Enforce k-anonymity
4. Settle payments (if request-based)
5. Mark job as finalized
6. Set FHE permissions for buyer

**Emits**: `JobFinalized`, `RequestCompleted` (if request)

**K-Anonymity Check**:

```solidity
ebool meetsAnonymity = FHE.ge(state.kept, job.kAnonymity);
euint256 failureValue = FHE.asEuint256(type(uint128).max);
result = FHE.select(meetsAnonymity, actualResult, failureValue);
```

If k-anonymity is not met, result is set to `type(uint128).max` sentinel value.

### Request Lifecycle Functions

#### submitRequest

Buyer creates a computation request with payment.

```solidity
function submitRequest(
    uint256 datasetId,
    JobParams calldata params,
    uint256 baseFee
) external payable returns (uint256 requestId)
```

**Parameters**:

- `datasetId`: Dataset to query
- `params`: Job parameters
- `baseFee`: Fixed fee for seller (≤ msg.value)

**Payment**: `msg.value` = baseFee + computeAllowance

**Emits**: `RequestSubmitted`

**Example**:

```typescript
const baseFee = ethers.parseEther("0.1");
const computeAllowance = ethers.parseEther("0.5");

const tx = await jobManager.submitRequest(datasetId, jobParams, baseFee, {
  value: baseFee + computeAllowance,
});
```

#### acceptRequest

Seller accepts request and creates job.

```solidity
function acceptRequest(uint256 requestId)
    external nonReentrant
    returns (uint256 jobId)
```

**Validation**:

- Request must be PENDING
- Caller must be dataset owner
- All job validations apply

**Effects**:

- Creates job
- Sets status to ACCEPTED
- Links job to request
- Starts gas tracking

**Emits**: `RequestAccepted`

#### rejectRequest

Seller rejects request (full refund to buyer).

```solidity
function rejectRequest(uint256 requestId) external nonReentrant
```

**Effects**:

- Refunds baseFee + computeAllowance to buyer
- Sets status to REJECTED

**Emits**: `RequestRejected`

#### cancelRequest

Buyer cancels pending request (full refund).

```solidity
function cancelRequest(uint256 requestId) external nonReentrant
```

**Validation**:

- Request must be PENDING
- Caller must be buyer

**Emits**: `RequestCancelled`

#### reclaimStalled

Buyer reclaims funds from stalled job (after 24 hours).

```solidity
function reclaimStalled(uint256 requestId) external nonReentrant
```

**Validation**:

- Request must be ACCEPTED
- Caller must be buyer
- 24 hours must have passed since last activity

**Effects**:

- Pays seller gasDebtToSeller for work done
- Refunds buyer: computeAllowance + baseFee
- Sets status to REJECTED

**Emits**: `RequestStalled`

#### requestPayout

Seller manually requests payout of accumulated gas debt.

```solidity
function requestPayout(uint256 requestId) external
```

**Auto-payout** occurs when debt ≥ `paymentThreshold` (default 0.05 ETH).

#### topUpAllowance

Buyer adds more compute allowance to active job.

```solidity
function topUpAllowance(uint256 requestId) external payable
```

**Emits**: `AllowanceToppedUp`

### View Functions

```solidity
function nextJobId() external view returns (uint256);
function nextRequestId() external view returns (uint256);
function jobBuyer(uint256 jobId) external view returns (address);
function jobOpen(uint256 jobId) external view returns (bool);
function jobDataset(uint256 jobId) external view returns (uint256);

function getJobProgress(uint256 jobId) external view returns (
    uint256 totalRows,
    uint256 processedRows,
    uint256 remainingRows
);

function getJobResult(uint256 jobId) external view returns (
    bool isFinalized,
    euint256 result,
    ebool isOverflow
);

function getRequest(uint256 requestId)
    external view returns (JobRequest memory);
```

## RowDecoder Library

**Purpose**: Parse and decode encrypted row data from packed binary format.

### Main Function

```solidity
function decodeRowTo64(bytes calldata rowPacked)
    internal
    returns (euint64[] memory fields)
```

### Packed Row Format

Each row is ABI-encoded as a sequence of fields:

```
Field := TypeTag || ExtLen || ExtCipher || ProofLen || Proof

TypeTag:   uint8  (1 = euint8, 2 = euint32, 3 = euint64)
ExtLen:    uint16 (big-endian, length of ExtCipher)
ExtCipher: bytes  (external encrypted value)
ProofLen:  uint16 (big-endian, length of Proof)
Proof:     bytes  (ZK proof for decryption)
```

**Example**: Row with 2 fields (euint8, euint32)

```
[ 0x01 | 0x0020 | <32 bytes cipher> | 0x0100 | <256 bytes proof> |
  0x02 | 0x0020 | <32 bytes cipher> | 0x0100 | <256 bytes proof> ]
```

### Type Conversion

All encrypted types are upcast to `euint64` for uniform processing:

```solidity
euint8  → FHE.asEuint64(euint8)  → euint64
euint32 → FHE.asEuint64(euint32) → euint64
euint64 → (no conversion)         → euint64
```

### Validation

```solidity
function validateRowStructure(bytes calldata rowPacked)
    internal pure
    returns (uint256 fieldCount)
```

**Checks**:

- Complete fields (no truncation)
- Valid type tags (1, 2, or 3)
- No extra data at end

## Supported Operations

### COUNT

Count rows that pass the filter.

**Parameters**: None (filter determines which rows count)

**Accumulation**: `kept` counter tracks encrypted count

**Result**: `euint64(kept)` cast to `euint256`

**Example**:

```typescript
// Count users with age > 18
{
  op: Op.COUNT,
  targetField: 0,  // ignored
  weights: [],
  divisor: 0,
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: compileFilterDSL(gt(0, 18))  // age field
}
```

### SUM

Sum values of target field for rows that pass filter.

**Parameters**:

- `targetField`: Column to sum

**Accumulation**: `agg += select(keep, field[targetField], 0)`

**Result**: `agg`

**Example**:

```typescript
// Sum salaries of engineers
{
  op: Op.SUM,
  targetField: 2,  // salary column
  weights: [],
  divisor: 0,
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: compileFilterDSL(eq(1, 1))  // role == 1 (engineer)
}
```

### AVG_P

Average with plaintext divisor (privacy-preserving approximation).

**Parameters**:

- `targetField`: Column to average
- `divisor`: Plaintext divisor (must be > 0)

**Accumulation**: Same as SUM

**Result**: `agg / divisor`

**Use Case**: When you know row count in advance or use fixed divisor for privacy.

**Example**:

```typescript
// Average age (assume 100 rows)
{
  op: Op.AVG_P,
  targetField: 0,  // age column
  weights: [],
  divisor: 100,    // divide by 100
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: { bytecode: "0x", consts: [] }  // no filter
}
```

### WEIGHTED_SUM

Compute weighted sum across all fields.

**Parameters**:

- `weights`: Array of weights (length must equal numColumns)

**Accumulation**:

```solidity
for each row:
  weightedSum = Σ(weights[i] * fields[i])
  agg += select(keep, weightedSum, 0)
```

**Result**: `agg`

**Overflow Detection**: Tracks multiplication and addition overflow

**Example**:

```typescript
// Portfolio value: price * quantity for each asset
{
  op: Op.WEIGHTED_SUM,
  targetField: 0,  // ignored
  weights: [100, 200, 150],  // prices for 3 assets
  divisor: 0,
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: compileFilterDSL(gt(0, 0))  // only non-zero holdings
}
```

### MIN

Find minimum value of target field among filtered rows.

**Parameters**:

- `targetField`: Column to minimize

**Accumulation**:

```solidity
minV = select(keep,
  select(minMaxInit, min(minV, field[targetField]), field[targetField]),
  minV
)
minMaxInit = or(minMaxInit, keep)
```

**Result**: `minV`

**Example**:

```typescript
// Lowest salary in department 5
{
  op: Op.MIN,
  targetField: 2,  // salary column
  weights: [],
  divisor: 0,
  clampMin: 0n,
  clampMax: 0n,
  roundBucket: 0,
  filter: compileFilterDSL(eq(1, 5))  // department == 5
}
```

### MAX

Find maximum value of target field among filtered rows.

**Parameters**:

- `targetField`: Column to maximize

**Accumulation**: Similar to MIN but uses `max()`

**Result**: `maxV`

## Post-Processing

Applied **after** operation but **before** k-anonymity check.

### Clamping

Restrict result to [clampMin, clampMax] range.

```solidity
function _clamp(euint64 value, uint64 minBound, uint64 maxBound)
    internal returns (euint64)
{
    if (minBound > 0) value = FHE.max(value, minBound);
    if (maxBound > 0) value = FHE.min(value, maxBound);
    return value;
}
```

**Example**:

```typescript
{
  // ... operation params
  clampMin: 0n,
  clampMax: 1000n,  // Cap result at 1000
}
```

### Bucket Rounding

Round to nearest multiple of bucket size.

```solidity
function _roundBucket(euint64 value, uint32 bucket)
    internal returns (euint64)
{
    // ((value + bucket/2) / bucket) * bucket
    euint64 halfBucket = FHE.asEuint64(bucket / 2);
    euint64 sum = FHE.add(value, halfBucket);
    euint64 quotient = FHE.div(sum, bucket);
    return FHE.mul(quotient, bucket);
}
```

**Example**:

```typescript
{
  // ... operation params
  roundBucket: 10,  // Round to nearest 10
}
// 23 → 20, 25 → 30, 27 → 30
```

## Privacy Features

### K-Anonymity

**Concept**: Result is only released if at least k rows contribute.

**Implementation**:

```solidity
// Count kept rows
state.kept = count of rows where filter returns true

// At finalize
ebool meetsAnonymity = FHE.ge(state.kept, job.kAnonymity);
euint256 sentinel = FHE.asEuint256(type(uint128).max);
result = FHE.select(meetsAnonymity, actualResult, sentinel);
```

**Detection** (after decryption):

```typescript
const decrypted = await fhevmInstance.decrypt(result, userAddress);

if (decrypted === BigInt(2 ** 128 - 1)) {
  // K-anonymity NOT met
  console.log("Result suppressed for privacy");
} else {
  // Valid result
  console.log("Result:", decrypted);
}
```

### Cooldown Period

**Purpose**: Prevent rapid re-querying for correlation attacks.

**Implementation**:

```solidity
bytes32 key = keccak256(abi.encodePacked(buyer, datasetId));
uint64 lastUse = _lastUse[key];

require(
  lastUse == 0 || block.timestamp >= lastUse + cooldownSec,
  "CooldownActive"
);

// On finalize
_lastUse[key] = uint64(block.timestamp);
```

**Example**: With 1 hour cooldown, buyer must wait 1 hour between queries on same dataset.

### Overflow Detection

**Purpose**: Detect arithmetic overflow in FHE operations.

**Tracking**:

```solidity
// Addition overflow
euint64 next = FHE.add(current, value);
ebool overflow = FHE.lt(next, current);  // wrapped around
state.isOverflow = FHE.or(state.isOverflow, overflow);

// Multiplication overflow
euint64 product = FHE.mul(a, b);
ebool mulOverflow = FHE.ne(FHE.div(product, b), a);  // a*b/b != a
state.isOverflow = FHE.or(state.isOverflow, mulOverflow);
```

**Result**: `isOverflow` flag returned with result, buyer can decrypt to check validity.

## Events Reference

### DatasetRegistry Events

```solidity
event DatasetCommitted(
    uint256 indexed datasetId,
    bytes32 merkleRoot,
    uint256 numColumns,
    uint256 rowCount,
    address indexed owner,
    euint32 kAnonymity,
    uint32 cooldownSec
);

event DatasetDeleted(
    uint256 indexed datasetId,
    address indexed owner
);

event JobManagerSet(
    address indexed jobManager
);
```

### JobManager Events

```solidity
event JobOpened(
    uint256 indexed jobId,
    uint256 indexed datasetId,
    address indexed buyer
);

event RowPushed(
    uint256 indexed jobId
);

event JobFinalized(
    uint256 indexed jobId,
    address indexed buyer,
    euint256 result,
    ebool isOverflow
);

event RequestSubmitted(
    uint256 indexed requestId,
    uint256 indexed datasetId,
    address indexed buyer
);

event RequestAccepted(
    uint256 indexed requestId,
    uint256 indexed jobId
);

event RequestRejected(
    uint256 indexed requestId
);

event RequestCompleted(
    uint256 indexed requestId,
    uint256 indexed jobId
);

event RequestCancelled(
    uint256 indexed requestId
);

event RequestStalled(
    uint256 indexed requestId
);

event SellerPaid(
    uint256 indexed requestId,
    address indexed seller,
    uint256 amount
);

event AllowanceToppedUp(
    uint256 indexed requestId,
    uint256 amount
);

event ThresholdUpdated(
    uint256 newThreshold
);
```

## Errors Reference

### DatasetRegistry Errors

```solidity
error DatasetNotFound();
error DatasetAlreadyExists();
error NotDatasetOwner();
error InvalidMerkleRoot();
error InvalidNumColumns();
error InvalidRowCount();
error InvalidRowSchema();
error JobManagerNotSet();
error InvalidJobManagerAddress();
error RowCountExceedsUint64Max();
```

### JobManager Errors

```solidity
// Job Errors
error JobClosed();
error JobNotFinalized();
error NotJobBuyer();
error NotDatasetOwner();
error DatasetNotFound();
error RowOutOfOrder();
error MerkleVerificationFailed();
error InvalidRowSchema();
error IncompleteProcessing();

// Parameter Validation Errors
error CannotDivideByZero();
error WeightsLengthMismatch();
error InvalidFieldIndex();
error InvalidClampRange();
error FilterBytecodeTooLong();
error FilterConstsTooLong();

// Privacy Errors
error CooldownActive();
error KAnonymityNotMet();

// Request Errors
error RequestNotPending();
error NotRequestBuyer();
error InsufficientPayment();
error InsufficientAllowance();
error PaymentFailed();
error NotStalled();

// Filter VM Errors
error FilterVMUnknownOpcode(uint8 opcode);
error FilterVMInsufficientBytecode();
error FilterVMInvalidFieldIndex();
error FilterVMInvalidConstantIndex();
error FilterVMStackOverflow(string stackName);
error FilterVMStackUnderflow(string stackName);
error FilterVMInvalidFinalStackState();
error FilterVMStackNotEmpty(string stackName);
```

---

**Related Documentation**:

- [Architecture Guide](ARCHITECTURE.md)
- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Filter VM Specification](FILTER_VM.md)
- [Gas Benchmarking](gas_benchmarking.md)
