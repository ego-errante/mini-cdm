# Mini-DCM Architecture

This document provides a comprehensive overview of Mini-DCM's system architecture, including smart contract design, data flow, payment mechanisms, security model, and frontend architecture.

## Table of Contents

- [System Overview](#system-overview)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Data Flow](#data-flow)
- [Payment System](#payment-system)
- [Security Model](#security-model)
- [Frontend Architecture](#frontend-architecture)
- [Package Organization](#package-organization)

## System Overview

Mini-DCM is a decentralized marketplace for confidential data analytics built on three core principles:

1. **Privacy-First**: All computations use Fully Homomorphic Encryption (FHE)
2. **Trustless**: Cryptographic proofs ensure data integrity
3. **Flexible**: Multiple interaction patterns and payment models

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Dataset    │  │   Request    │  │     Job      │          │
│  │  Management  │  │  Management  │  │  Processing  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │   MetaMask/Wallet  │
                    └─────────┬──────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                   Ethereum Network (FHEVM)                       │
│                                                                   │
│  ┌──────────────────┐              ┌──────────────────┐         │
│  │ DatasetRegistry  │              │   JobManager     │         │
│  │                  │              │                  │         │
│  │ • Commit Dataset │◄─────────────┤ • Open Job       │         │
│  │ • Verify Owner   │  Validates   │ • Push Row       │         │
│  │ • Store Metadata │              │ • Finalize       │         │
│  │ • K-Anonymity    │              │ • Requests       │         │
│  └──────────────────┘              │ • Payments       │         │
│                                     └──────────────────┘         │
│                                              │                   │
│                                     ┌────────▼────────┐          │
│                                     │   RowDecoder    │          │
│                                     │  (Library)      │          │
│                                     │                 │          │
│                                     │ • Parse Rows    │          │
│                                     │ • Type Casting  │          │
│                                     └─────────────────┘          │
└───────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                      Off-Chain Storage                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Encrypted Dataset Rows + Merkle Proofs (JSON/CSV)      │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component           | Role                           | Location               |
| ------------------- | ------------------------------ | ---------------------- |
| **DatasetRegistry** | Dataset metadata and ownership | Smart Contract         |
| **JobManager**      | Job execution and payments     | Smart Contract         |
| **RowDecoder**      | Encrypted data parsing         | Smart Contract Library |
| **Frontend**        | User interface                 | Next.js Application    |
| **FHEVM Instance**  | Encryption/Decryption          | Browser + Zama Relayer |
| **Merkle Proofs**   | Data integrity verification    | Off-chain Storage      |

## Smart Contract Architecture

### Contract Relationships

```
┌─────────────────────────────────────────────────────────────────┐
│                        JobManager                                │
│                                                                   │
│  Job Lifecycle              Request System         Payments      │
│  • openJob()                • submitRequest()      • Gas Tracking│
│  • pushRow()                • acceptRequest()      • Threshold   │
│  • finalize()               • rejectRequest()      • Settlement  │
│                             • reclaimStalled()                   │
│                                                                   │
│  Filter VM                  Accumulators           Privacy       │
│  • _evalFilter()            • _updateAccumulators  • K-Anonymity │
│  • Stack-based execution    • COUNT/SUM/AVG/etc   • Cooldowns   │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                        Uses RowDecoder
                        Queries DatasetRegistry
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                      DatasetRegistry                             │
│                                                                   │
│  Dataset Management         Ownership              Enumeration   │
│  • commitDataset()          • isDatasetOwner()    • getAllIds() │
│  • deleteDataset()          • Access control      • getDatasets()│
│  • getDataset()                                                  │
│                                                                   │
│  Metadata Storage                                                │
│  • Merkle Root              • K-Anonymity (encrypted)            │
│  • Row Count                • Cooldown Period                    │
│  • Column Count             • Owner Address                      │
└───────────────────────────────────────────────────────────────────┘
```

### DatasetRegistry

**Purpose**: Manages dataset registration, metadata, and ownership.

**Key State Variables**:

```solidity
mapping(uint256 => Dataset) private _datasets;
uint256[] private _datasetIds;  // For enumeration
address private _jobManager;    // Reference to JobManager
```

**Dataset Structure**:

```solidity
struct Dataset {
    bytes32 merkleRoot;      // Cryptographic commitment to data
    uint256 numColumns;      // Schema: number of fields per row
    uint256 rowCount;        // Total rows in dataset
    address owner;           // Dataset owner/seller
    bool exists;             // Existence flag
    euint32 kAnonymity;      // Min result size (encrypted)
    uint32 cooldownSec;      // Time between queries per buyer
}
```

**Core Functions**:

- `commitDataset()`: Register new dataset with metadata
- `deleteDataset()`: Remove dataset (owner only)
- `getDataset()`: Retrieve dataset metadata
- `isDatasetOwner()`: Verify ownership
- `getAllDatasets()`: Enumerate all datasets

### JobManager

**Purpose**: Orchestrates job execution, manages requests, and handles payments.

**Key State Variables**:

```solidity
mapping(uint256 => Job) private _jobs;
mapping(uint256 => JobState) private _state;
mapping(uint256 => JobRequest) private _requests;
mapping(uint256 => uint256) private _jobToRequest;
mapping(bytes32 => uint64) private _lastUse;  // Cooldown tracking
```

**Job Structure**:

```solidity
struct Job {
    JobParams params;        // Operation configuration
    address buyer;           // Result recipient
    uint256 datasetId;       // Dataset reference
    bool isFinalized;        // Completion status
    euint256 result;         // Encrypted result
    bytes32 merkleRoot;      // Cached for verification
    uint256 rowCount;        // Cached for validation
    uint32 cooldownSec;      // Cached for enforcement
    euint32 kAnonymity;      // Cached for privacy check
}
```

**JobState Structure** (Accumulators):

```solidity
struct JobState {
    euint64 agg;             // SUM/WEIGHTED_SUM accumulator
    euint64 minV;            // MIN tracking
    euint64 maxV;            // MAX tracking
    euint32 kept;            // COUNT of kept rows (for k-anonymity)
    ebool minMaxInit;        // MIN/MAX initialization flag
    ebool isOverflow;        // Overflow detection
}
```

**Core Functions**:

- `openJob()`: Initialize job for buyer
- `pushRow()`: Process encrypted row with Merkle proof
- `finalize()`: Complete job and release result
- `submitRequest()`: Buyer creates request
- `acceptRequest()`: Seller accepts and creates job
- `rejectRequest()`: Seller rejects request
- `reclaimStalled()`: Buyer reclaims from stalled job

### RowDecoder

**Purpose**: Parse and decode encrypted row data from packed format.

**Key Function**:

```solidity
function decodeRowTo64(bytes calldata rowPacked)
    internal
    returns (euint64[] memory fields)
```

**Packed Row Format**:

Each field in a row is encoded as:

```
┌─────────┬──────────┬─────────────┬───────────┬────────┐
│ TypeTag │ ExtLen   │ ExtCipher   │ ProofLen  │ Proof  │
│ (uint8) │ (uint16) │ (bytes)     │ (uint16)  │ (bytes)│
└─────────┴──────────┴─────────────┴───────────┴────────┘
  1 byte    2 bytes    ExtLen bytes  2 bytes     ProofLen bytes

TypeTag: 1=euint8, 2=euint32, 3=euint64
```

**Type Casting**: All field types are upcast to `euint64` for uniform processing in JobManager.

## Data Flow

### Dataset Creation Flow

```
┌────────┐
│ Seller │
└───┬────┘
    │
    │ 1. Generate dataset locally
    │    • Create encrypted rows
    │    • Build Merkle tree
    │    • Store rows + proofs off-chain
    │
    ▼
┌─────────────────┐
│ Frontend        │
│ • Encrypt data  │
│ • Build Merkle  │
└────────┬────────┘
         │
         │ 2. commitDataset(id, merkleRoot, metadata, kAnonymity)
         │
         ▼
┌─────────────────┐
│ DatasetRegistry │
│ • Store metadata│
│ • Set owner     │
│ • Emit event    │
└─────────────────┘
```

### Request-Based Job Flow

```
┌───────┐                          ┌────────┐
│ Buyer │                          │ Seller │
└───┬───┘                          └───┬────┘
    │                                  │
    │ 1. submitRequest()               │
    │    + baseFee + computeAllowance  │
    ▼                                  │
┌──────────────┐                      │
│ JobManager   │                      │
│ • Create req │                      │
│ • Hold funds │                      │
│ Status: PENDING                     │
└──────────────┘                      │
    │                                  │
    │ 2. Event: RequestSubmitted       │
    ├─────────────────────────────────►│
    │                                  │
    │                                  │ 3a. acceptRequest()
    │                                  │     (creates Job)
    │◄─────────────────────────────────┤
    │                                  │
┌──────────────┐                      │
│ JobManager   │                      │
│ • Create job │                      │
│ • Link to req│                      │
│ Status: ACCEPTED                    │
└──────────────┘                      │
    │                                  │
    │                                  │ 4. pushRow() loop
    │                                  │    • Verify Merkle proof
    │◄─────────────────────────────────┤    • Track gas usage
    │                                  │    • Auto-payout if threshold
    │                                  │
    │                                  │ 5. finalize()
    │                                  │    • Final settlement
    │◄─────────────────────────────────┤    • Pay seller
    │                                  │    • Refund buyer excess
┌──────────────┐                      │
│ JobManager   │                      │
│ • Compute    │                      │
│   result     │                      │
│ • Pay seller │                      │
│ • Refund     │                      │
│   buyer      │                      │
│ Status: COMPLETED                   │
└──────────────┘                      │
    │                                  │
    │ 6. Buyer decrypts result        │
    ▼                                  │
┌───────┐                              │
│ Buyer │                              │
└───────┘                              │
```

### Row Processing Pipeline

```
┌──────────────────────────────────────────────────────────────┐
│ 1. pushRow(jobId, rowPacked, merkleProof, rowIndex)         │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 2. Validate                                                   │
│    • Job is open                                              │
│    • Sequential row order (rowIndex = last + 1)               │
│    • Caller is dataset owner                                  │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 3. Verify Merkle Proof                                        │
│    leaf = keccak256(datasetId, rowIndex, rowPacked)           │
│    verifyProof(leaf, proof, merkleRoot) → must be true        │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 4. Decode Row (RowDecoder)                                    │
│    rowPacked → euint64[] fields                               │
│    • Parse type tags                                          │
│    • Extract ciphertexts and proofs                           │
│    • Convert to euint64 (upcast)                              │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 5. Evaluate Filter (Filter VM)                                │
│    fields + filter bytecode → ebool keep                      │
│    • Execute stack-based VM                                   │
│    • Compare encrypted values to plaintext constants          │
│    • Return encrypted boolean                                 │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 6. Update Accumulators                                        │
│    • kept += select(keep, 1, 0)                               │
│    • Operation-specific accumulation:                         │
│      - COUNT: (nothing, use kept)                             │
│      - SUM/AVG_P: agg += select(keep, field[target], 0)       │
│      - WEIGHTED_SUM: agg += select(keep, weighted_sum, 0)     │
│      - MIN/MAX: conditional update                            │
│    • Overflow tracking                                        │
└───────────────────────────┬──────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│ 7. Track Gas (if request-based)                              │
│    • gasUsed = gasBefore - gasleft()                          │
│    • cost = gasUsed * tx.gasprice                             │
│    • computeAllowance -= cost                                 │
│    • gasDebtToSeller += cost                                  │
│    • Auto-payout if debt ≥ threshold                          │
└───────────────────────────────────────────────────────────────┘
```

## Payment System

### Request-Based Payment Model

**Payment Components**:

1. **Base Fee**: Fixed payment for dataset access (paid on completion)
2. **Compute Allowance**: Gas budget for job processing (deducted per operation)
3. **Gas Debt**: Accumulated costs owed to seller

**Payment Flow**:

```
┌─────────────────────────────────────────────────────────────────┐
│ Buyer submits request with msg.value                            │
│   • baseFee: Fixed fee for seller                               │
│   • computeAllowance: Gas budget for computation                │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Funds held in escrow (JobManager contract)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
┌──────────────────┐          ┌────────────────────┐
│ acceptRequest()  │          │ pushRow() calls    │
│ • Tracks gas     │          │ • Track gas/tx     │
│ • Deduct from    │          │ • Accumulate debt  │
│   allowance      │          │ • Auto-payout at   │
│ • Add to debt    │          │   threshold        │
└──────────────────┘          └──────┬─────────────┘
                                     │
                                     ▼
                         ┌────────────────────────┐
                         │ Threshold reached?     │
                         │ (debt ≥ 0.05 ETH)      │
                         └──────┬─────────────────┘
                                │
                    ┌───────────┴──────────┐
                    │                      │
                    ▼                      ▼
          ┌──────────────────┐    ┌────────────┐
          │ Auto-payout to   │    │ Continue   │
          │ seller           │    │ tracking   │
          │ • Reset debt     │    └────────────┘
          └──────────────────┘
                    │
                    ▼
         ┌────────────────────────────┐
         │ finalize()                 │
         │ • Pay remaining debt       │
         │ • Pay base fee             │
         │ • Refund unused allowance  │
         └────────────────────────────┘
```

**Gas Tracking Logic**:

```solidity
function _trackGasAndMaybePayout(uint256 requestId, uint256 gasBefore) {
    uint256 gasUsed = gasBefore - gasleft();
    uint256 cost = gasUsed * tx.gasprice;

    // STRICT: Must have sufficient allowance
    require(cost <= request.computeAllowance, "InsufficientAllowance");

    // Deduct and accumulate
    request.computeAllowance -= cost;
    request.gasDebtToSeller += cost;

    // Auto-payout if threshold reached
    if (request.gasDebtToSeller >= paymentThreshold) {
        _payoutSeller(requestId);
    }
}
```

### Stall Protection

If seller stops processing after 24 hours:

```solidity
function reclaimStalled(uint256 requestId) external {
    require(msg.sender == request.buyer);
    require(block.timestamp > request.timestamp + STALL_TIMEOUT);

    // Pay seller for work done
    if (request.gasDebtToSeller > 0) {
        _payoutSeller(requestId);
    }

    // Refund buyer: remaining allowance + base fee (job incomplete)
    uint256 refund = request.computeAllowance + request.baseFee;
    // ... transfer refund
}
```

## Security Model

### Cryptographic Security

**Merkle Tree Verification**:

```
Dataset Commitment:
├─ Off-chain: Store rows + proofs
└─ On-chain: Store merkleRoot only

Verification:
┌─────────────────────────────────────────────┐
│ leaf = keccak256(datasetId, rowIndex, row) │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│ Verify: computeRoot(leaf, proof) == root   │
│ • Prevents data substitution               │
│ • Ensures row authenticity                 │
└─────────────────────────────────────────────┘
```

**Sequential Processing Enforcement**:

```solidity
// Track last processed row per job
mapping(uint256 jobId => uint256 lastRowIndex) private _jobLastProcessedRow;

// Validate sequential order
if (_jobLastProcessedRow[jobId] == type(uint256).max) {
    require(rowIndex == 0); // First row
} else {
    require(rowIndex == _jobLastProcessedRow[jobId] + 1); // Next row
}
```

### Privacy Guarantees

**K-Anonymity Enforcement**:

```solidity
// Check if k-anonymity threshold is met
ebool meetsAnonymity = FHE.ge(state.kept, job.kAnonymity);

// Return actual result if met, sentinel value if not
euint256 failureValue = FHE.asEuint256(type(uint128).max);
result = FHE.select(meetsAnonymity, actualResult, failureValue);
```

**Cooldown Protection**:

```solidity
// Prevent rapid re-querying
bytes32 cooldownKey = keccak256(abi.encodePacked(buyer, datasetId));
uint64 lastUse = _lastUse[cooldownKey];

require(
    lastUse == 0 || block.timestamp >= lastUse + cooldownSec,
    "CooldownActive"
);
```

### Access Control

**Owner-Based Permissions**:

- Only dataset owner can push rows
- Only dataset owner can accept/reject requests
- Only buyer can decrypt job results
- Only buyer can reclaim stalled requests

**Reentrancy Protection**:

```solidity
contract JobManager is ReentrancyGuard {
    function finalize(uint256 jobId) external nonReentrant {
        // Protected against reentrancy attacks
    }

    function acceptRequest(uint256 requestId) external nonReentrant {
        // Protected against reentrancy attacks
    }
}
```

## Frontend Architecture

### Technology Stack

- **Next.js 15**: App router, server components, client components
- **React 19**: Modern hooks, concurrent features
- **TanStack Query**: Data fetching, caching, synchronization
- **Ethers.js v6**: Blockchain interaction
- **FHEVM SDK**: Encryption/decryption via Zama relayer
- **Radix UI**: Accessible component primitives
- **Tailwind CSS**: Utility-first styling

### Context Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CDMProvider                             │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ MetaMask State (useMetaMaskEthersSigner)             │   │
│  │ • provider, chainId, accounts                        │   │
│  │ • ethersSigner, ethersReadonlyProvider               │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────▼──────────────────────────────┐   │
│  │ FHEVM State (useFhevm)                               │   │
│  │ • fhevmInstance (encryption/decryption)              │   │
│  │ • status, error                                      │   │
│  └──────────────────────────────────────────────────────┘   │
│                          │                                   │
│  ┌───────────────────────┴──────────────────────────────┐   │
│  │ Contract Hooks                                       │   │
│  │ • useDatasetRegistry (TanStack Query)                │   │
│  │ • useJobManager (TanStack Query)                     │   │
│  │ • useGasPrice                                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  Consumed by: useCDMContext()                                │
└───────────────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
App Layout
└─ Providers
   └─ CDMProvider
      └─ Page
         ├─ Overview
         │  ├─ StatusBadgesPopover (network/wallet status)
         │  ├─ CreateDatasetModal
         │  ├─ DatasetCard (per dataset)
         │  │  ├─ NewRequestModal
         │  │  └─ DatasetDrawer
         │  │     ├─ ActivityTable
         │  │     ├─ JobProcessorModal
         │  │     └─ ViewResultModal
         │  └─ ...
         └─ ...
```

### Data Flow Pattern

**TanStack Query Pattern**:

```typescript
// In useDatasetRegistry hook
const getDatasetsQuery = useQuery({
  queryKey: ["datasets", contractAddress],
  queryFn: async () => {
    const contract = new ethers.Contract(address, abi, provider);
    const datasets = await contract.getAllDatasets();
    return datasets;
  },
  enabled: isDeployed && !!ethersReadonlyProvider,
  refetchInterval: 5000, // Auto-refresh
});

// In component
const { getDatasetsQuery } = datasetRegistry;
const datasets = getDatasetsQuery.data || [];
```

**Mutation Pattern**:

```typescript
const commitDatasetMutation = useMutation({
  mutationFn: async (params) => {
    const contract = new ethers.Contract(address, abi, signer);
    const tx = await contract.commitDataset(...params);
    await tx.wait();
  },
  onSuccess: () => {
    queryClient.invalidateQueries(["datasets"]);
  },
});
```

## Package Organization

### Monorepo Structure

```
mini-dcm/
├─ packages/
│  ├─ fhevm-hardhat-template/    [Contracts + Tests]
│  │  • Solidity contracts
│  │  • Hardhat configuration
│  │  • Deployment scripts
│  │  • Comprehensive tests
│  │
│  ├─ site/                       [Frontend App]
│  │  • Next.js application
│  │  • React components
│  │  • Contract ABIs (generated)
│  │  • Custom hooks
│  │
│  ├─ fhevm-shared/               [Shared Utilities]
│  │  • TypeScript types
│  │  • Filter DSL compiler
│  │  • Merkle tree helpers
│  │  • Encryption utilities
│  │
│  ├─ fhevm-react/                [React Integration]
│  │  • useFhevm hook
│  │  • FHEVM instance management
│  │
│  └─ postdeploy/                 [Post-Deploy Tasks]
│     • ABI extraction
│     • Address updates
│
└─ workspaces configuration (npm)
```

### Dependency Graph

```
site
 ├─ depends on → fhevm-shared (types, filterDsl, merkle)
 ├─ depends on → fhevm-react (useFhevm)
 └─ uses ABIs from → fhevm-hardhat-template (generated)

fhevm-hardhat-template
 └─ depends on → fhevm-shared (types, filterDsl for tests)

fhevm-react
 └─ standalone (FHEVM SDK wrapper)

fhevm-shared
 └─ standalone (pure utilities)
```

### Build Process

1. **Development**: `npm run dev:mock`
   - Starts Hardhat node (background)
   - Deploys contracts
   - Generates ABIs
   - Starts Next.js dev server

2. **Production**: `npm run build`
   - Builds fhevm-shared package
   - Generates contract ABIs
   - Builds Next.js app
   - Ready for Netlify deployment

## Performance Considerations

### Gas Optimization

- **Caching**: Store frequently accessed dataset metadata in Job struct
- **Batch Payouts**: Threshold-based settlement reduces transactions
- **Stack Depth**: Filter VM limited to 8 elements per stack
- **Sequential Processing**: Single-pass row processing

### Frontend Optimization

- **Query Caching**: TanStack Query deduplicates and caches requests
- **Refetch Intervals**: Configurable auto-refresh (default 5s)
- **Optimistic Updates**: UI updates before blockchain confirmation
- **Code Splitting**: Next.js automatic route-based splitting

### Blockchain Interaction

- **Read Operations**: Use readonly provider (no signing)
- **Write Operations**: Require signer (MetaMask confirmation)
- **Event Listening**: Subscribe to contract events for real-time updates

## Scalability Considerations

### Current Limitations

- **Row-by-row Processing**: Each row requires separate transaction
- **On-chain Gas Costs**: FHE operations are expensive
- **Filter Complexity**: Limited by stack depth and gas limits
- **Dataset Size**: Large datasets require many transactions

### Future Improvements

- **Batch Processing**: Process multiple rows per transaction
- **Off-chain Computation**: ZK proofs for verification
- **Layer 2 Integration**: Reduce gas costs on L2
- **Optimized Operations**: Specialized circuits for common patterns

---

**Related Documentation**:

- [Smart Contracts Reference](SMART_CONTRACTS.md)
- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Filter VM Specification](FILTER_VM.md)
- [Frontend Development](FRONTEND_DEVELOPMENT.md)
