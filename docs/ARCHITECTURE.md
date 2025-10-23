# Mini-CDM Architecture

This document provides a comprehensive overview of Mini-CDM's system architecture, including smart contract design, data flow, payment mechanisms, security model, and frontend architecture.

## Table of Contents

- [System Overview](#system-overview)
- [Smart Contract Architecture](#smart-contract-architecture)
- [Data Flow](#data-flow)
- [Payment System](#payment-system)
- [Security Model](#security-model)
- [Frontend Architecture](#frontend-architecture)
- [Package Organization](#package-organization)

## System Overview

Mini-CDM is a decentralized marketplace for confidential data analytics built on three core principles:

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

**Responsibilities**:

- Store dataset metadata (merkle root, schema, owner, k-anonymity, cooldown)
- Validate dataset ownership for job operations
- Provide enumeration for frontend display
- Link to JobManager for access control

**Key Properties per Dataset**:

- Cryptographic commitment (merkle root)
- Schema definition (numColumns, rowCount)
- Privacy settings (encrypted k-anonymity, cooldown period)
- Owner address for access control

**See contract source**: `packages/fhevm-hardhat-template/contracts/DatasetRegistry.sol`

### JobManager

**Purpose**: Orchestrates job execution, manages requests, and handles payments.

**Responsibilities**:

**Job Management**:

- Create jobs (direct or via accepted requests)
- Process rows sequentially with Merkle verification
- Execute Filter VM on encrypted data
- Maintain operation-specific accumulators
- Enforce k-anonymity and privacy policies

**Request System**:

- Accept buyer requests with escrow
- Track request lifecycle (PENDING → ACCEPTED → COMPLETED/REJECTED)
- Link requests to jobs for payment tracking

**Payment Handling**:

- Track gas costs per operation
- Accumulate seller debt with threshold-based auto-payout
- Handle final settlement on job completion
- Support stall protection and reclaim

**Privacy Enforcement**:

- Verify cooldown periods
- Enforce k-anonymity thresholds
- Track overflow conditions
- Apply post-processing (clamp, round)

**See contract source**: `packages/fhevm-hardhat-template/contracts/JobManager.sol`

### RowDecoder

**Purpose**: Parse and decode encrypted row data from packed binary format.

**Functionality**:

- Validate packed row structure (type tags, lengths, proofs)
- Extract encrypted ciphertexts and ZK proofs
- Convert external encrypted values to internal FHE types
- Upcast all types to euint64 for uniform processing

**Binary Format**: Each field encoded as TypeTag | ExtLen | ExtCipher | ProofLen | Proof

**See contract source**: `packages/fhevm-hardhat-template/contracts/RowDecoder.sol`

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

### Complete Workflow Overview

**See [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md) for detailed flow diagrams and state transitions.**

**Key Workflows**:

1. **Dataset Creation**: Seller encrypts data → builds Merkle tree → commits metadata on-chain
2. **Request Submission**: Buyer submits request with payment → held in escrow
3. **Job Processing**: Seller accepts → processes rows sequentially → finalizes with settlement
4. **Result Decryption**: Buyer decrypts result → checks k-anonymity and overflow flags

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

Mini-CDM supports two payment models:

1. **Direct Jobs**: Off-chain payment arrangements
2. **Request-Based**: On-chain escrow with automatic gas tracking and settlement

### Request-Based Payment Architecture

**Components**:

- **Base Fee**: Fixed payment for dataset access (held until job completion)
- **Compute Allowance**: Gas budget deducted per operation (acceptRequest, pushRow, finalize)
- **Gas Debt**: Accumulated costs owed to seller (auto-payout at threshold)
- **Payment Threshold**: Default 0.05 ETH triggers automatic seller payout

**Key Features**:

- Strict allowance enforcement (transaction reverts if insufficient)
- Automatic threshold-based payouts (reduces transaction count)
- Final settlement on job completion
- Stall protection: buyer can reclaim after 24 hours of inactivity

**See [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md) for detailed payment flows, examples, and state diagrams.**

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

**Built with**: Next.js 15, React 19, TanStack Query, Ethers.js v6, FHEVM SDK, Radix UI, Tailwind CSS

**Architecture Pattern**:

- **Global Context** (CDMProvider): Wallet, FHEVM instance, contract hooks
- **Server State** (TanStack Query): Blockchain data with caching and auto-refresh
- **Component Patterns**: Modals for actions, drawers for details, tables for activity

**Key Integration Points**:

- MetaMask wallet via EIP-6963
- FHEVM instance for encryption/decryption
- Contract hooks wrapping ethers.js with TanStack Query
- Real-time updates via polling and event listeners

**See [Frontend Development](FRONTEND_DEVELOPMENT.md) for detailed guide, code examples, and testing.**

## Package Organization

### Monorepo Structure (npm workspaces)

```
mini-cdm/
├─ packages/
│  ├─ fhevm-hardhat-template/  → Smart contracts, tests, deployment
│  ├─ site/                     → Next.js frontend application
│  ├─ fhevm-shared/             → Shared utilities (types, filterDsl, merkle)
│  ├─ fhevm-react/              → FHEVM React integration (useFhevm)
│  └─ postdeploy/               → Post-deployment automation
```

### Dependency Graph

```
site → fhevm-shared, fhevm-react, ABIs from fhevm-hardhat-template
fhevm-hardhat-template → fhevm-shared (for tests)
fhevm-react → standalone
fhevm-shared → standalone
```

### Build Workflow

**Development**: `npm run dev:mock`

1. Checks if Hardhat node is running
2. Auto-deploys contracts if needed
3. Generates ABIs for frontend
4. Starts Next.js dev server

**Production**: `npm run build`

1. Builds fhevm-shared package
2. Generates contract ABIs
3. Builds Next.js application
4. Outputs to `packages/site/.next`

## Design Trade-offs

### Performance vs Privacy

**Row-by-Row Processing**:

- ➕ Fine-grained Merkle verification
- ➕ Sequential integrity enforcement
- ➖ High gas costs (one transaction per row)
- ➖ Longer job completion times

**On-Chain FHE Operations**:

- ➕ Complete privacy (no decryption)
- ➕ Trustless computation
- ➖ Expensive gas costs
- ➖ Limited operation complexity

### Security vs Flexibility

**Sequential Row Processing**:

- ➕ Prevents row skipping attacks
- ➕ Simplifies state tracking
- ➖ No parallel processing
- ➖ Cannot process subset of rows

**Stack Depth Limits (8 elements)**:

- ➕ Prevents unbounded gas consumption
- ➕ Guarantees termination
- ➖ Limits filter complexity
- ➖ Requires careful expression structuring

### Scalability Paths

**See README.md "Future Improvements" for planned enhancements including batch processing, ZK preflight validation, and Layer 2 integration.**

---

**Related Documentation**:

- [Request & Job Lifecycle](REQUEST_JOB_LIFECYCLE.md)
- [Filter VM Specification](FILTER_VM.md)
- [Frontend Development](FRONTEND_DEVELOPMENT.md)
