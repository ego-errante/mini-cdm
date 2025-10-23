# Request & Job Lifecycle

Complete guide to the request-based and direct job interaction models in Mini-DCM, including state transitions, payment flows, and code examples.

## Table of Contents

- [Overview](#overview)
- [Interaction Models](#interaction-models)
- [Request Lifecycle](#request-lifecycle)
- [Job Lifecycle](#job-lifecycle)
- [Payment Flow](#payment-flow)
- [State Diagrams](#state-diagrams)
- [Code Examples](#code-examples)
- [Best Practices](#best-practices)

## Overview

Mini-DCM supports two interaction patterns:

1. **Direct Job Model**: Dataset owner creates jobs directly for buyers (trusted/partnered scenarios)
2. **Request-Based Model**: Buyers submit requests, sellers accept and fulfill (marketplace scenarios)

Both models execute the same job processing pipeline but differ in initiation and payment handling.

## Interaction Models

### Direct Job Model

**Use Case**: Pre-arranged agreements, internal analytics, trusted partnerships

**Flow**:

```
Buyer contacts Seller (off-chain)
         ↓
Seller calls openJob(datasetId, buyerAddress, params)
         ↓
Seller processes rows (pushRow)
         ↓
Seller finalizes job
         ↓
Buyer decrypts result
```

**Payment**: Handled off-chain or via separate arrangements

**Pros**:

- Simpler flow
- Lower gas costs (no request management)
- Immediate job creation

**Cons**:

- Requires off-chain coordination
- No built-in payment escrow
- Seller must know buyer address in advance

### Request-Based Model

**Use Case**: Open marketplace, anonymous buyers, on-chain payment guarantees

**Flow**:

```
Buyer submits request with payment (submitRequest)
         ↓
Seller reviews and accepts/rejects
         ↓
If accepted: Job created automatically
         ↓
Seller processes rows with gas tracking
         ↓
Seller finalizes with automatic settlement
         ↓
Buyer decrypts result
```

**Payment**: Fully on-chain with escrow and gas tracking

**Pros**:

- No off-chain coordination needed
- Payment guarantees for both parties
- Automatic gas reimbursement
- Stall protection

**Cons**:

- Higher gas costs
- More complex state management
- 24-hour stall timeout required

## Request Lifecycle

### State Transitions

```
        submitRequest()
              │
              ▼
         ┌─────────┐
         │ PENDING │
         └─────────┘
              │
      ┌───────┴────────┐
      │                │
acceptRequest()   rejectRequest()
      │            cancelRequest()
      ▼                │
 ┌──────────┐          │
 │ ACCEPTED │          │
 └──────────┘          │
      │                │
      │                │
  finalize()           │
      │                │
      ▼                ▼
 ┌───────────┐   ┌──────────┐
 │ COMPLETED │   │ REJECTED │
 └───────────┘   └──────────┘
```

### 1. Submit Request (PENDING)

**Actor**: Buyer

**Function**: `submitRequest()`

```solidity
function submitRequest(
    uint256 datasetId,
    JobParams calldata params,
    uint256 baseFee
) external payable returns (uint256 requestId)
```

**Payment Breakdown**:

- `baseFee`: Fixed payment for dataset access (held until completion)
- `computeAllowance`: `msg.value - baseFee` (gas budget for processing)

**State After Submission**:

```
Status: PENDING
jobId: 0 (not yet created)
baseFee: Held in escrow
computeAllowance: Available for gas deductions
gasDebtToSeller: 0
```

### 2a. Accept Request (ACCEPTED)

**Actor**: Dataset Owner/Seller

**Function**: `acceptRequest()`

```solidity
function acceptRequest(uint256 requestId)
    external nonReentrant
    returns (uint256 jobId)
```

**Effects**:

1. Validates seller is dataset owner
2. Creates job internally via `_createJob()`
3. Links job to request
4. Resets timestamp (for stall detection)
5. Tracks gas usage for acceptRequest call

**State After Acceptance**:

```
Status: ACCEPTED
jobId: Created and linked
timestamp: Reset for stall detection
gasDebtToSeller: Gas for acceptRequest
computeAllowance: Deducted by acceptRequest gas cost
```

### 2b. Reject Request (REJECTED)

**Actor**: Dataset Owner/Seller

**Function**: `rejectRequest()`

**Effects**:

- Full refund: `baseFee + computeAllowance` returned to buyer
- Status set to REJECTED
- No job created

### 2c. Cancel Request (REJECTED)

**Actor**: Buyer

**Function**: `cancelRequest()`

**Requirements**:

- Status must be PENDING
- Caller must be original buyer

**Effects**: Same as reject (full refund)

### 3. Process Job (ACCEPTED → COMPLETED)

**Actor**: Dataset Owner/Seller

**Functions**: `pushRow()` (multiple calls) + `finalize()`

See [Job Lifecycle](#job-lifecycle) section below.

**Gas Tracking**: Each `pushRow()` and `finalize()` call tracks gas:

```solidity
function _trackGasAndMaybePayout(uint256 requestId, uint256 gasBefore) {
    uint256 gasUsed = gasBefore - gasleft();
    uint256 cost = gasUsed * tx.gasprice;

    require(cost <= request.computeAllowance, "InsufficientAllowance");

    request.computeAllowance -= cost;
    request.gasDebtToSeller += cost;

    // Auto-payout if threshold reached (default 0.05 ETH)
    if (request.gasDebtToSeller >= paymentThreshold) {
        _payoutSeller(requestId);
    }
}
```

### 4. Finalize Request (COMPLETED)

**Actor**: Dataset Owner/Seller

**Function**: `finalize()` (same as direct jobs, but with payment settlement)

**Final Settlement**:

```solidity
// Pay seller
uint256 sellerPayout = request.gasDebtToSeller + request.baseFee;
request.gasDebtToSeller = 0;
request.baseFee = 0;

// Refund buyer unused allowance
uint256 buyerRefund = request.computeAllowance;
request.computeAllowance = 0;

request.status = RequestStatus.COMPLETED;

// Transfer funds
payable(seller).call{value: sellerPayout}("");
payable(buyer).call{value: buyerRefund}("");
```

**Example Flow**:

```
Initial Payment: 0.6 ETH (0.1 base + 0.5 allowance)

After processing:
  Gas used: 0.3 ETH
  Remaining allowance: 0.2 ETH

Final Settlement:
  Seller receives: 0.1 (base) + 0.3 (gas) = 0.4 ETH
  Buyer refund: 0.2 ETH (unused allowance)
```

### 5. Stall Protection (REJECTED)

**Actor**: Buyer

**Function**: `reclaimStalled()`

**Requirements**:

- Status must be ACCEPTED
- 24 hours since last activity (`request.timestamp + STALL_TIMEOUT`)

**Effects**:

1. Pay seller `gasDebtToSeller` for work done
2. Refund buyer `computeAllowance + baseFee` (job incomplete)
3. Set status to REJECTED

**Timing**: Available after `request.timestamp + STALL_TIMEOUT` (24 hours)

## Job Lifecycle

### State Progression

```
openJob() or acceptRequest()
         │
         ▼
    ┌────────┐
    │  OPEN  │ (isFinalized = false)
    └────────┘
         │
         │ pushRow() × N
         │ (sequential, 0 to rowCount-1)
         │
         ▼
   ┌──────────┐
   │ ALL ROWS │
   │ PROCESSED│
   └──────────┘
         │
         │ finalize()
         │
         ▼
  ┌────────────┐
  │ FINALIZED  │ (isFinalized = true)
  └────────────┘
```

### 1. Open Job

**Direct Model**: Call `openJob(datasetId, buyerAddress, jobParams)`

**Request Model**: Automatically created via `acceptRequest()`

**Initial Job State**:

```javascript
{
  params: {...},
  buyer: "0xBuyer...",
  datasetId: 1,
  isFinalized: false,
  result: 0,  // Encrypted zero
  merkleRoot: "0x...",  // Cached from dataset
  rowCount: 100,        // Cached from dataset
  cooldownSec: 3600,    // Cached from dataset
  kAnonymity: <encrypted> // Cached from dataset
}

// Accumulators
{
  agg: 0 (encrypted),
  minV: 0 (encrypted),
  maxV: 0 (encrypted),
  kept: 0 (encrypted),
  minMaxInit: false (encrypted),
  isOverflow: false (encrypted)
}
```

### 2. Push Rows

**Sequential Processing**: Rows MUST be pushed in order (0, 1, 2, ..., rowCount-1)

**Process**: For each row, call `pushRow(jobId, rowPacked, merkleProof, rowIndex)`

**Per-Row Processing**:

1. **Validate**: Job open, sequential order, caller is owner
2. **Verify**: Merkle proof against dataset root
3. **Decode**: Parse encrypted fields from packed format
4. **Filter**: Execute bytecode VM to get `keep` boolean
5. **Accumulate**: Update operation-specific accumulators
6. **Track Gas**: Deduct from allowance (if request-based)

**Progress Tracking**: Use `getJobProgress(jobId)` to retrieve `processedRows`, `totalRows`, and `remainingRows`

### 3. Finalize Job

**Requirements**:

- All rows must be processed (`processedRows === totalRows`)
- Job must be open (`isFinalized === false`)

**Call**: `finalize(jobId)`

**Emits**: `JobFinalized` event with encrypted `result` and `isOverflow` flag

**Internal Steps**:

1. **Compute Result**: Based on operation type (COUNT → kept, SUM → agg, AVG_P → agg/divisor, etc.)

2. **Post-Process**: Apply clamping and rounding if configured

3. **K-Anonymity Check**: Return sentinel value (type(uint128).max) if threshold not met

4. **Set Permissions**: Allow buyer to decrypt result and overflow flag

5. **Update Cooldown**: Record timestamp for buyer-dataset pair

6. **Settle Payments** (if request-based): Pay seller baseFee + gasDebt, refund buyer unused allowance

### 4. Decrypt Result

**Actor**: Buyer

**Process**:

1. Get encrypted result via `getJobResult(jobId)` → returns `result` and `isOverflow`
2. Use FHEVM instance to decrypt both values
3. Check for k-anonymity sentinel value (`2^128 - 1`)
4. Check overflow flag
5. Use decrypted value if valid

## Payment Flow

### Payment Components

| Component             | Description                            | Timing                        |
| --------------------- | -------------------------------------- | ----------------------------- |
| **Base Fee**          | Fixed payment for dataset access       | Paid on completion            |
| **Compute Allowance** | Gas budget for job processing          | Deducted per operation        |
| **Gas Debt**          | Accumulated costs owed to seller       | Paid at threshold or finalize |
| **Threshold**         | Auto-payout trigger (default 0.05 ETH) | When debt reaches threshold   |

### Flow Diagram

```
┌─────────────────────────────────────────────────────────┐
│ Buyer Submits: 0.6 ETH (0.1 base + 0.5 allowance)      │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Escrow in JobManager Contract                           │
│  • baseFee: 0.1 ETH                                     │
│  • computeAllowance: 0.5 ETH                            │
│  • gasDebtToSeller: 0                                   │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        │                         │
        ▼                         ▼
┌──────────────┐          ┌──────────────┐
│ acceptRequest│          │ pushRow #1   │
│ Gas: 0.01 ETH│          │ Gas: 0.02 ETH│
└──────┬───────┘          └──────┬───────┘
       │                         │
       ▼                         ▼
allowance: 0.49 ETH      allowance: 0.47 ETH
debt: 0.01 ETH           debt: 0.03 ETH
       │                         │
       │    ... more rows ...    │
       │                         │
       ▼                         ▼
┌──────────────────────────────────────┐
│ pushRow #25                          │
│ Gas: 0.02 ETH                        │
│ Debt: 0.05 ETH → THRESHOLD REACHED! │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Auto-Payout to Seller: 0.05 ETH     │
│ debt = 0, allowance = 0.43 ETH      │
└──────────────┬───────────────────────┘
               │
               │ ... continue processing ...
               │
               ▼
┌──────────────────────────────────────┐
│ finalize()                           │
│ Final gas: 0.03 ETH                  │
│ Total debt: 0.03 ETH                 │
│ Remaining allowance: 0.40 ETH        │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│ Final Settlement                     │
│  • Seller: 0.1 (base) + 0.05 (auto) │
│           + 0.03 (final) = 0.18 ETH  │
│  • Buyer refund: 0.40 ETH            │
│  • Total spent: 0.6 - 0.4 = 0.2 ETH  │
└──────────────────────────────────────┘
```

### Top-Up Allowance

If buyer's `computeAllowance` is running low during job processing, they can add more funds via `topUpAllowance(requestId)` with additional ETH.

### Manual Payout

Seller can manually trigger payout of accumulated `gasDebtToSeller` before auto-payout threshold via `requestPayout(requestId)`.

## State Diagrams

### Complete Request Flow

```
┌────────┐
│ BUYER  │
└───┬────┘
    │
    │ 1. submitRequest()
    │    msg.value = baseFee + allowance
    ▼
┌─────────────┐
│  PENDING    │────────┐
└─────────────┘        │
    │                  │
    │                  │ 2b. rejectRequest()
    │                  │     OR cancelRequest()
    │                  │     → Full refund
    │                  │
    │ 2a. acceptRequest()
    │     → Create job
    │     → Track gas
    ▼                  │
┌─────────────┐        │
│  ACCEPTED   │        │
└─────────────┘        │
    │                  │
    │ 3. pushRow() × N │
    │    → Track gas   │
    │    → Auto-payout │
    │                  │
    │ 4a. finalize()   │ 4b. 24h timeout
    │     → Settle     │     → reclaimStalled()
    │                  │         • Pay seller debt
    │                  │         • Refund buyer base+allowance
    ▼                  ▼
┌─────────────┐   ┌──────────┐
│ COMPLETED   │   │ REJECTED │
└─────────────┘   └──────────┘
```

### Job Processing State

```
┌────────────────────┐
│ Job Created        │
│ isFinalized: false │
│ processedRows: 0   │
└──────────┬─────────┘
           │
           │ pushRow(0)
           │ → Verify Merkle
           │ → Decode row
           │ → Eval filter
           │ → Update accumulators
           ▼
┌────────────────────┐
│ processedRows: 1   │
└──────────┬─────────┘
           │
           │ pushRow(1)
           ▼
┌────────────────────┐
│ processedRows: 2   │
└──────────┬─────────┘
           │
           │ ... continue ...
           │
           │ pushRow(N-1)
           ▼
┌────────────────────┐
│ processedRows: N   │
│ All rows complete  │
└──────────┬─────────┘
           │
           │ finalize()
           │ → Compute result
           │ → Post-process
           │ → K-anonymity check
           │ → Settle payments
           ▼
┌────────────────────┐
│ isFinalized: true  │
│ result: <encrypted>│
└────────────────────┘
```

## Code Examples

### Complete Direct Job Flow

```typescript
import { ethers } from "ethers";
import { compileFilterDSL, gt } from "@fhevm/shared";

// 1. Dataset owner creates job
const jobParams = {
  op: 3, // COUNT
  targetField: 0,
  weights: [],
  divisor: 0,
  clampMin: 0n,
  clampMax: 100n, // Privacy: cap at 100
  roundBucket: 10, // Privacy: round to nearest 10
  filter: compileFilterDSL(gt(0, 18)), // age > 18
};

const openTx = await jobManager.openJob(datasetId, buyerAddress, jobParams);
const openReceipt = await openTx.wait();
const jobId = openReceipt.logs[0].args.jobId;

console.log(`Job ${jobId} created`);

// 2. Load dataset from off-chain storage
const dataset = await fetch(`/api/datasets/${datasetId}`).then((r) => r.json());

// 3. Process all rows
for (let i = 0; i < dataset.rowCount; i++) {
  const tx = await jobManager.pushRow(
    jobId,
    dataset.rows[i],
    dataset.proofs[i],
    i
  );
  await tx.wait();
  console.log(`Row ${i + 1}/${dataset.rowCount} processed`);
}

// 4. Finalize job
const finalizeTx = await jobManager.finalize(jobId);
await finalizeTx.wait();

console.log("Job finalized!");

// 5. Buyer decrypts result
const { result, isOverflow } = await jobManager.getJobResult(jobId);
const fhevmInstance = await createInstance({ chainId, provider });

const decryptedResult = await fhevmInstance.decrypt(result, buyerAddress);
const overflowFlag = await fhevmInstance.decrypt(isOverflow, buyerAddress);

if (decryptedResult === BigInt(2 ** 128 - 1)) {
  console.log("K-anonymity not met");
} else if (overflowFlag) {
  console.warn("Overflow detected!");
} else {
  console.log("Result:", decryptedResult);
}
```

### Complete Request-Based Flow

```typescript
// === BUYER SIDE ===

// 1. Submit request
const baseFee = ethers.parseEther("0.1");
const allowance = ethers.parseEther("0.5");

const submitTx = await jobManager.submitRequest(datasetId, jobParams, baseFee, {
  value: baseFee + allowance,
});

const submitReceipt = await submitTx.wait();
const requestId = submitReceipt.logs[0].args.requestId;

console.log(`Request ${requestId} submitted`);

// 2. Monitor request status
const checkStatus = async () => {
  const request = await jobManager.getRequest(requestId);

  if (request.status === 0) {
    console.log("Request pending...");
  } else if (request.status === 1) {
    console.log("Request accepted, job in progress");

    // Check progress
    const progress = await jobManager.getJobProgress(request.jobId);
    console.log(`${progress.processedRows}/${progress.totalRows} rows`);
  } else if (request.status === 3) {
    console.log("Request completed!");

    // Decrypt result
    const { result } = await jobManager.getJobResult(request.jobId);
    const decrypted = await fhevmInstance.decrypt(result, buyerAddress);
    console.log("Result:", decrypted);
  } else {
    console.log("Request rejected/cancelled");
  }
};

const interval = setInterval(checkStatus, 5000);

// === SELLER SIDE ===

// 1. Listen for requests
jobManager.on("RequestSubmitted", async (reqId, dsId, buyer) => {
  console.log(`New request ${reqId} for dataset ${dsId}`);

  // Check ownership
  const isOwner = await datasetRegistry.isDatasetOwner(dsId, sellerAddress);

  if (!isOwner) return;

  // Review and accept
  const request = await jobManager.getRequest(reqId);

  if (request.baseFee < ethers.parseEther("0.05")) {
    console.log("Base fee too low, rejecting");
    await jobManager.rejectRequest(reqId);
    return;
  }

  console.log("Accepting request...");
  const acceptTx = await jobManager.acceptRequest(reqId);
  const acceptReceipt = await acceptTx.wait();
  const jobId = acceptReceipt.logs[0].args.jobId;

  // 2. Process job
  const dataset = await loadDataset(dsId);

  for (let i = 0; i < dataset.rowCount; i++) {
    await jobManager.pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
    console.log(`Row ${i + 1}/${dataset.rowCount}`);
  }

  // 3. Finalize (automatic settlement)
  await jobManager.finalize(jobId);
  console.log("Job complete, payment received!");
});
```

## Best Practices

### For Buyers

1. **Estimate Costs**: Use gas benchmarking (`estimateJobGas()` or `estimateJobAllowance()`) to calculate expected allowance.
2. **Monitor Allowance**: Top up if running low during processing
3. **Set Stall Alerts**: Check for 24h inactivity and reclaim if needed
4. **Validate Results**: Always check k-anonymity sentinel (`2^128-1`) and overflow flag after decryption
5. **Use Post-Processing**: Add clamping and rounding for additional privacy

### For Sellers

1. **Review Requests**: Check base fee and allowance before accepting
2. **Handle Errors**: Implement retry logic for failed pushRow calls
3. **Monitor Threshold**: Adjust `paymentThreshold` based on gas prices
4. **Batch Processing**: Process multiple rows in rapid succession
5. **Verify Off-Chain**: Validate dataset integrity before commitment

### Security

1. **Never Skip Rows**: Sequential processing is enforced on-chain
2. **Validate Merkle Proofs**: Ensure dataset hasn't been tampered with
3. **Check Cooldowns**: Respect privacy guarantees
4. **Monitor Overflow**: Alert buyers when overflow detected
5. **Escrow Trust**: Funds are held in contract, not by seller

---

**Related Documentation**:

- [Architecture Guide](ARCHITECTURE.md)
- [Filter VM Specification](FILTER_VM.md)
- [Gas Benchmarking](GAS_BENCHMARKING.md)
