import { DatasetRegistry } from "../../types";
import { JobManager } from "../../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { Signers, deployDatasetRegistryFixture, deployJobManagerFixture } from "../utils";
import {
  KAnonymityLevels,
  OpCodes,
  parseRowToColumnConfigs,
  createPackedEncryptedRow,
  generateMerkleTreeFromRows,
  type EncryptedDataset,
  type EncryptedRow,
  type JobParams,
  type FilterProg,
  DEFAULT_GAS_PRICE,
  estimateJobAllowance,
} from "@fhevm/shared";

/**
 * This test suite uses the EXACT same functions from @fhevm/shared that the frontend uses
 * to replicate the full user flow:
 * 1. Parse dataset from raw data (like CSV/JSON parsing)
 * 2. Encrypt dataset using createPackedEncryptedRow
 * 3. Generate merkle tree using generateMerkleTreeFromRows
 * 4. Commit dataset to registry
 * 5. Submit request as buyer
 * 6. Accept request as seller
 * 7. Process rows using pushRow
 * 8. Finalize job
 */
describe("JobManager - Frontend Flow with @fhevm/shared utilities", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    // Deploy contracts
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress } = await deployJobManagerFixture(datasetRegistryContractAddress));

    // Set the JobManager address on the DatasetRegistry
    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);
  });

  /**
   * NOTE: We use the EXACT same createPackedEncryptedRow from @fhevm/shared that the frontend uses!
   * Hardhat's fhevm object has the same API as the browser FhevmInstance, so it works directly.
   */

  /**
   * Step 1: Create and encrypt dataset (exactly like CreateDatasetModal does)
   */
  async function createAndEncryptDataset(
    rawData: number[][],
    datasetId: bigint,
    owner: HardhatEthersSigner,
  ): Promise<EncryptedDataset> {
    console.log(`\n=== Creating Dataset ${datasetId} ===`);
    console.log(`Rows: ${rawData.length}, Columns: ${rawData[0].length}`);

    const encryptedRows: EncryptedRow[] = [];

    // Encrypt each row (EXACT same as frontend CreateDatasetModal does)
    const userAddress = await owner.getAddress();

    for (let i = 0; i < rawData.length; i++) {
      const rowData = rawData[i];

      // Parse row to column configs (EXACT same function from @fhevm/shared)
      const columnConfigs = parseRowToColumnConfigs(rowData);

      // Encrypt using EXACT same function from @fhevm/shared that frontend uses!
      // Hardhat's fhevm works as the fhevmInstance parameter
      const encryptedData = await createPackedEncryptedRow(
        jobManagerContractAddress,
        userAddress,
        fhevm, // Hardhat's fhevm object works just like browser's FhevmInstance
        columnConfigs,
      );

      encryptedRows.push({ rowIndex: i, encryptedData });
      console.log(`  Row ${i} encrypted: ${encryptedData.substring(0, 66)}...`);
    }

    // Generate merkle tree (EXACT same function from @fhevm/shared)
    const rowStrings = encryptedRows.map((r) => r.encryptedData);
    const { root, proofs } = generateMerkleTreeFromRows(rowStrings, datasetId);

    console.log(`Merkle root: ${root}`);

    const encryptedDataset: EncryptedDataset = {
      datasetId: datasetId.toString(),
      rows: encryptedRows,
      proofs,
      numColumns: rawData[0].length,
      rowCount: rawData.length,
      merkleRoot: root,
    };

    return encryptedDataset;
  }

  /**
   * Step 2: Commit dataset to registry (like frontend does)
   */
  async function commitDatasetToRegistry(
    dataset: EncryptedDataset,
    owner: HardhatEthersSigner,
    kAnonymity: number = KAnonymityLevels.NONE,
    cooldownSec: number = 0,
  ) {
    console.log(`\n=== Committing Dataset ${dataset.datasetId} ===`);

    const datasetRegistryAddress = await datasetRegistryContract.getAddress();
    const encryptedKAnonymity = await fhevm
      .createEncryptedInput(datasetRegistryAddress, owner.address)
      .add32(kAnonymity)
      .encrypt();

    await datasetRegistryContract
      .connect(owner)
      .commitDataset(
        BigInt(dataset.datasetId),
        dataset.rowCount,
        dataset.merkleRoot,
        dataset.numColumns,
        encryptedKAnonymity.handles[0],
        encryptedKAnonymity.inputProof,
        cooldownSec,
      );

    console.log(`Dataset committed successfully`);
  }

  /**
   * Step 3: Submit request (like useJobManager.submitRequestMutation does)
   */
  async function submitRequest(
    datasetId: bigint,
    buyer: HardhatEthersSigner,
    jobParams: JobParams,
    baseFee: bigint,
    computeAllowance: bigint,
  ): Promise<bigint> {
    console.log(`\n=== Submitting Request ===`);
    console.log(`Buyer: ${buyer.address}`);
    console.log(`Base fee: ${ethers.formatEther(baseFee)} ETH`);
    console.log(`Compute allowance: ${ethers.formatEther(computeAllowance)} ETH`);

    const requestId = await jobManagerContract.nextRequestId();
    const totalValue = baseFee + computeAllowance;

    // Convert readonly arrays to mutable for contract call
    const contractJobParams = {
      ...jobParams,
      weights: [...jobParams.weights],
      filter: {
        ...jobParams.filter,
        consts: [...jobParams.filter.consts],
      },
    };

    await jobManagerContract.connect(buyer).submitRequest(datasetId, contractJobParams, baseFee, { value: totalValue });

    console.log(`Request ${requestId} submitted`);
    return requestId;
  }

  /**
   * Step 4: Accept request (like useJobManager.acceptRequestMutation does)
   */
  async function acceptRequest(requestId: bigint, seller: HardhatEthersSigner): Promise<bigint> {
    console.log(`\n=== Accepting Request ${requestId} ===`);

    await jobManagerContract.connect(seller).acceptRequest(requestId);

    const request = await jobManagerContract.getRequest(requestId);
    const jobId = request.jobId;

    console.log(`Job ${jobId} created`);
    return jobId;
  }

  /**
   * Step 5: Process rows (like JobProcessorModal does)
   */
  async function processRows(jobId: bigint, dataset: EncryptedDataset, seller: HardhatEthersSigner) {
    console.log(`\n=== Processing Rows for Job ${jobId} ===`);

    for (let i = 0; i < dataset.rows.length; i++) {
      const row = dataset.rows[i];
      const proof = dataset.proofs[i];

      // Get progress before
      const progressBefore = await jobManagerContract.getJobProgress(jobId);

      // Push row (like useJobManager.pushRowMutation does)
      await jobManagerContract.connect(seller).pushRow(jobId, row.encryptedData, proof, i);

      // Get progress after
      const progressAfter = await jobManagerContract.getJobProgress(jobId);
      console.log(`  Row ${i}: ${progressBefore[1]} → ${progressAfter[1]} / ${progressAfter[0]}`);
    }

    console.log(`All rows processed`);
  }

  /**
   * Step 6: Finalize job (like useJobManager.finalizeJobMutation does)
   */
  async function finalizeJob(jobId: bigint, seller: HardhatEthersSigner) {
    console.log(`\n=== Finalizing Job ${jobId} ===`);

    await jobManagerContract.connect(seller).finalize(jobId);

    console.log(`Job finalized`);
  }

  /**
   * Create default job params (like frontend does)
   */
  function createJobParams(op: number = OpCodes.COUNT, targetField: number = 0): JobParams {
    const filter: FilterProg = {
      bytecode: "0x",
      consts: [],
    };

    return {
      op,
      targetField,
      weights: [],
      divisor: 0,
      clampMin: 0n,
      clampMax: 0n,
      roundBucket: 0,
      filter,
    };
  }

  /**
   * MAIN TEST: Full end-to-end flow using frontend utilities
   */
  it("should complete full flow using exact frontend functions from @fhevm/shared", async function () {
    // Sample dataset (like user would upload CSV/JSON)
    const rawData = [
      [10, 20, 30],
      [40, 50, 60],
      [70, 80, 90],
      [100, 110, 120],
      [130, 140, 150],
    ];

    const datasetId = BigInt(1);
    const datasetOwner = signers.alice;
    const buyer = signers.bob;

    // Step 1: Encrypt dataset (using @fhevm/shared functions)
    const encryptedDataset = await createAndEncryptDataset(rawData, datasetId, datasetOwner);
    expect(encryptedDataset.rows.length).to.equal(5);
    expect(encryptedDataset.proofs.length).to.equal(5);

    // Step 2: Commit to registry
    await commitDatasetToRegistry(encryptedDataset, datasetOwner);

    // Verify dataset exists
    const exists = await datasetRegistryContract.doesDatasetExist(datasetId);
    expect(exists).to.be.true;

    // Step 3: Submit request
    const jobParams = createJobParams(OpCodes.COUNT);
    const baseFee = ethers.parseEther("0.01");
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
    const computeAllowance = estimateJobAllowance(
      encryptedDataset.rowCount,
      encryptedDataset.numColumns,
      "COUNT",
      0,
      gasPrice,
    );

    const requestId = await submitRequest(datasetId, buyer, jobParams, baseFee, computeAllowance);

    // Verify request created
    const request = await jobManagerContract.getRequest(requestId);
    expect(request.buyer).to.equal(buyer.address);
    expect(request.status).to.equal(0); // PENDING

    // Step 4: Accept request
    const jobId = await acceptRequest(requestId, datasetOwner);
    expect(jobId).to.be.gt(0);

    // Verify job created
    const isOpen = await jobManagerContract.jobOpen(jobId);
    expect(isOpen).to.be.true;

    // Step 5: Process rows
    await processRows(jobId, encryptedDataset, datasetOwner);

    // Verify all rows processed
    const progress = await jobManagerContract.getJobProgress(jobId);
    expect(progress[1]).to.equal(BigInt(encryptedDataset.rowCount));
    expect(progress[2]).to.equal(0);

    // Step 6: Finalize
    await finalizeJob(jobId, datasetOwner);

    // Verify finalized
    const isFinalizedAfter = await jobManagerContract.jobOpen(jobId);
    expect(isFinalizedAfter).to.be.false;

    // Verify request completed
    const finalRequest = await jobManagerContract.getRequest(requestId);
    expect(finalRequest.status).to.equal(3); // COMPLETED

    console.log(`\n✅ Full flow completed successfully!`);
  });

  it("should fail with invalid merkle proof (debugging frontend error)", async function () {
    // Create dataset
    const rawData = [
      [10, 20, 30],
      [40, 50, 60],
    ];

    const datasetId = BigInt(2);
    const datasetOwner = signers.alice;
    const buyer = signers.bob;

    const encryptedDataset = await createAndEncryptDataset(rawData, datasetId, datasetOwner);
    await commitDatasetToRegistry(encryptedDataset, datasetOwner);

    // Submit and accept request
    const jobParams = createJobParams(OpCodes.COUNT);
    const baseFee = ethers.parseEther("0.01");
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
    const computeAllowance = estimateJobAllowance(2, 3, "COUNT", 0, gasPrice);

    const requestId = await submitRequest(datasetId, buyer, jobParams, baseFee, computeAllowance);
    const jobId = await acceptRequest(requestId, datasetOwner);

    // Try to push row with WRONG proof
    await expect(
      jobManagerContract.connect(datasetOwner).pushRow(
        jobId,
        encryptedDataset.rows[0].encryptedData,
        encryptedDataset.proofs[1], // Wrong proof!
        0,
      ),
    ).to.be.revertedWithCustomError(jobManagerContract, "MerkleVerificationFailed");
  });

  it("should handle SUM operation with parseRowToColumnConfigs", async function () {
    // Dataset with values that we'll sum
    const rawData = [
      [100, 200, 300],
      [150, 250, 350],
      [200, 300, 400],
    ];

    const datasetId = BigInt(3);
    const datasetOwner = signers.alice;
    const buyer = signers.bob;

    const encryptedDataset = await createAndEncryptDataset(rawData, datasetId, datasetOwner);
    await commitDatasetToRegistry(encryptedDataset, datasetOwner);

    // Submit request with SUM operation
    const jobParams = createJobParams(OpCodes.SUM, 0); // Sum first column
    const baseFee = ethers.parseEther("0.01");
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
    const computeAllowance = estimateJobAllowance(3, 3, "SUM", 0, gasPrice);

    const requestId = await submitRequest(datasetId, buyer, jobParams, baseFee, computeAllowance);
    const jobId = await acceptRequest(requestId, datasetOwner);

    // Process all rows
    await processRows(jobId, encryptedDataset, datasetOwner);

    // Finalize
    await finalizeJob(jobId, datasetOwner);

    // Verify completed
    const isFinalizedAfter = await jobManagerContract.jobOpen(jobId);
    expect(isFinalizedAfter).to.be.false;

    console.log(`\n✅ SUM operation completed successfully!`);
  });

  it("should replicate exact frontend error scenario from JobProcessorModal", async function () {
    /**
     * This test replicates the EXACT scenario from the frontend error:
     * - 5 rows, 5 columns
     * - Process rows sequentially
     * - Check all preconditions before each pushRow
     */

    const rawData = [
      [42, 1337, 999999, 10, 25],
      [43, 1338, 999998, 11, 26],
      [44, 1339, 999997, 12, 27],
      [45, 1340, 999996, 13, 28],
      [46, 1341, 999995, 14, 29],
    ];

    const datasetId = BigInt(4);
    const datasetOwner = signers.alice;
    const buyer = signers.bob;

    console.log(`\n=== Replicating Frontend Error Scenario ===`);

    // Create and commit dataset
    const encryptedDataset = await createAndEncryptDataset(rawData, datasetId, datasetOwner);
    await commitDatasetToRegistry(encryptedDataset, datasetOwner);

    // Submit request
    const jobParams = createJobParams(OpCodes.COUNT);
    const baseFee = ethers.parseEther("0.01");
    const gasPrice = (await ethers.provider.getFeeData()).gasPrice || DEFAULT_GAS_PRICE;
    const computeAllowance = estimateJobAllowance(5, 5, "COUNT", 0, gasPrice);

    const requestId = await submitRequest(datasetId, buyer, jobParams, baseFee, computeAllowance);
    const jobId = await acceptRequest(requestId, datasetOwner);

    // Process rows one by one with detailed logging (like JobProcessorModal)
    for (let i = 0; i < encryptedDataset.rows.length; i++) {
      console.log(`\n--- Processing Row ${i} ---`);

      // Check preconditions (like frontend would)
      const isOpen = await jobManagerContract.jobOpen(jobId);
      console.log(`Job ${jobId} is open: ${isOpen}`);
      expect(isOpen).to.be.true;

      const isOwner = await datasetRegistryContract.isDatasetOwner(datasetId, datasetOwner.address);
      console.log(`Is dataset owner: ${isOwner}`);
      expect(isOwner).to.be.true;

      const progressBefore = await jobManagerContract.getJobProgress(jobId);
      console.log(`Progress before: ${progressBefore[1]}/${progressBefore[0]}`);

      // Log data details
      const rowData = encryptedDataset.rows[i].encryptedData;
      const proof = encryptedDataset.proofs[i];
      console.log(`Row data length: ${rowData.length}`);
      console.log(`Proof length: ${proof.length}`);
      console.log(`Row data: ${rowData.substring(0, 100)}...`);

      // Push row
      const tx = await jobManagerContract.connect(datasetOwner).pushRow(jobId, rowData, proof, i);
      const receipt = await tx.wait();
      console.log(`Gas used: ${receipt?.gasUsed}`);

      const progressAfter = await jobManagerContract.getJobProgress(jobId);
      console.log(`Progress after: ${progressAfter[1]}/${progressAfter[0]}`);
      expect(progressAfter[1]).to.equal(BigInt(i + 1));
    }

    // Finalize
    await finalizeJob(jobId, datasetOwner);

    console.log(`\n✅ Successfully replicated frontend flow without errors!`);
  });
});
