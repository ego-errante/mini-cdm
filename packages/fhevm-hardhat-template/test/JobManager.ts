import { JobManager } from "../types";
import { DatasetRegistry } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import {
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  setupTestDataset,
  generateTestDatasetWithEncryption,
  TestDataset,
  OpCodes,
  createDefaultDatasetParams,
  generateTestDatasetWithCustomConfig,
  RowConfig,
} from "./utils";
import { TransactionReceipt } from "ethers";

describe("JobManager", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;
  let testDataset: TestDataset;
  let testDatasetOwner: HardhatEthersSigner;

  const firstDatasetRows = 4;
  const firstDatasetColumns = 1;
  const firstDatasetId = 1;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    // Deploy a new instance of the contract before each test
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress: jobManagerContractAddress } =
      await deployJobManagerFixture(datasetRegistryContractAddress));

    testDatasetOwner = signers.alice;

    testDataset = await setupTestDataset(
      datasetRegistryContract,
      jobManagerContractAddress,
      testDatasetOwner,
      firstDatasetId,
      firstDatasetRows,
      firstDatasetColumns,
    );
  });

  it("should deploy the contract", async () => {
    // console.log(`JobManager has been deployed at address ${jobManagerContractAddress}`);

    expect(jobManagerContract).to.not.be.null;
    expect(jobManagerContractAddress).to.not.be.null;
  });

  describe("openJob", () => {
    it("should open a job", async () => {
      const jobParams = createDefaultJobParams();

      // Open the job and expect the JobOpened event to be emitted
      await expect(jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice, jobParams))
        .to.emit(jobManagerContract, "JobOpened")
        .withArgs(0, testDataset.id, signers.alice); // jobId should be 0 for first job

      const jobId = 0; // First job should have ID 0

      // Verify the job was properly created
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;
      expect(await jobManagerContract.nextJobId()).to.equal(1); // Should be incremented to 1
    });

    it("should initialize job state with zero values after openJob", async () => {
      const datasetId = 1;
      const jobParams = createDefaultJobParams();

      await jobManagerContract.connect(signers.alice).openJob(datasetId, signers.alice.address, jobParams);
      const jobId = 0;

      // Verify dataset is stored
      expect(await jobManagerContract.jobDataset(jobId)).to.equal(datasetId);

      // Verify job buyer is set to alice
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);

      // Verify job is open
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;

      // Verify next job ID is incremented
      expect(await jobManagerContract.nextJobId()).to.equal(1);
    });

    it("should store different dataset IDs for different jobs", async () => {
      const testDataset2 = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice, 2);

      const job1Id = 0;
      const job2Id = 1;
      const jobParams1 = createDefaultJobParams();

      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.deployer.address, jobParams1);
      expect(await jobManagerContract.jobDataset(job1Id)).to.equal(testDataset.id);

      // Open second job with dataset 2
      await jobManagerContract.connect(signers.alice).openJob(testDataset2.id, signers.deployer.address, jobParams1);
      expect(await jobManagerContract.jobDataset(job2Id)).to.equal(testDataset2.id);
    });

    it("should reject openJob for non-existent dataset", async () => {
      const jobParams = createDefaultJobParams();

      // Open job on non-existent dataset
      const nonExistentDatasetId = 999;
      await expect(
        jobManagerContract.connect(signers.alice).openJob(nonExistentDatasetId, signers.alice.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    });

    it("should reject openJob for non-dataset-owner", async () => {
      const jobParams = createDefaultJobParams();

      // Bob (not dataset owner) tries to open job on Alice's dataset
      await expect(
        jobManagerContract.connect(signers.bob).openJob(testDataset.id, signers.bob.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "NotDatasetOwner");
    });

    it("should reject openJob when divisor is zero for operations that use it", async () => {
      const operationsToUseDivisor = [OpCodes.AVG_P];
      for (const op of operationsToUseDivisor) {
        const jobParams = {
          ...createDefaultJobParams(),
          op: op,
          divisor: 0, // Division by zero should be rejected
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Alice tries to open job with AVG_P and divisor = 0
        await expect(
          jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice.address, jobParams),
        ).to.be.revertedWithCustomError(jobManagerContract, "CannotDivideByZero");
      }
    });
  });

  describe("pushRow", () => {
    it("should emit RowPushed event when pushing a row", async () => {
      const testDataset2 = await setupTestDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.deployer,
        2,
      );

      // Open a job
      const jobParams = createDefaultJobParams();

      await jobManagerContract.connect(signers.deployer).openJob(testDataset2.id, signers.deployer.address, jobParams);
      const jobId = 0;

      await expect(
        jobManagerContract.connect(signers.deployer).pushRow(jobId, testDataset2.rows[0], testDataset2.proofs[0], 0),
      )
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should only accept rows in sequential ascending order", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Push row 0 - should succeed
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      // Try to skip to row 2 (skipping row 1) - should fail
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[2], testDataset.proofs[2], 2),
      ).to.be.revertedWithCustomError(jobManagerContract, "RowOutOfOrder");

      // Push row 1 - should succeed (next in sequence)
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[1], testDataset.proofs[1], 1);

      // Push row 2 - should succeed (next in sequence)
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[2], testDataset.proofs[2], 2),
      )
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should accept same row in different jobs", async () => {
      const jobParams = createDefaultJobParams();

      // Open first job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId1 = 0;

      // Open second job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId2 = 1;

      // Push row 0 to first job
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await jobManagerContract.connect(signers.alice).pushRow(jobId1, rowData, merkleProof, rowIndex);

      // Push same row to second job - should succeed (different job)
      await expect(jobManagerContract.connect(signers.alice).pushRow(jobId2, rowData, merkleProof, rowIndex))
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId2);
    });

    it("should reject pushRow from non-dataset-owner", async () => {
      const jobParams = createDefaultJobParams();

      // Alice opens job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Bob tries to push row - should fail
      const rowIndex = 0;
      const rowData = testDataset.rows[rowIndex]; // Now a hex string
      const merkleProof = testDataset.proofs[rowIndex];

      await expect(
        jobManagerContract.connect(signers.bob).pushRow(jobId, rowData, merkleProof, rowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "NotDatasetOwner");
    });

    it("should reject pushRow for finished job", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = 0;

      // Push all rows
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
      }

      // Finalize the job
      await jobManagerContract.connect(signers.alice).finalize(jobId);

      // Try to push another row - should fail with JobClosed
      const newRowIndex = testDataset.rows.length;
      const invalidRow = testDataset.rows[0]; // Using existing row data
      const invalidProof = testDataset.proofs[0]; // Using existing proof

      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, invalidRow, invalidProof, newRowIndex),
      ).to.be.revertedWithCustomError(jobManagerContract, "JobClosed");
    });

    it("should reject row with invalid schema", async () => {
      // Create a dataset with correct row data (1 column)
      const correctRowDataset = await generateTestDatasetWithEncryption(
        jobManagerContractAddress,
        signers.alice,
        2, // dataset ID
        2, // 2 rows
        1, // 1 column
      );

      // Register the dataset with an incorrect schema hash (claiming it has 2 columns instead of 1)
      const wrongSchemaHash = ethers.keccak256(ethers.solidityPacked(["uint256"], [2])); // Schema for 2 columns
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(2, correctRowDataset.rows.length, correctRowDataset.root, wrongSchemaHash);

      const jobParams = createDefaultJobParams();

      // Open job for this dataset
      await jobManagerContract.connect(signers.alice).openJob(2, signers.bob.address, jobParams);
      const jobId = 0;

      // Try to push a row with 1 column to a dataset registered as having 2 columns
      // This should fail because the schema doesn't match (row has 1 field but schema expects 2)
      await expect(
        jobManagerContract
          .connect(signers.alice)
          .pushRow(jobId, correctRowDataset.rows[0], correctRowDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "InvalidRowSchema");
    });
  });

  describe("finalize", () => {
    it("should finalize a job successfully", async () => {
      const jobId = 0;

      // Execute a job
      const receipt = await executeCountJob(jobManagerContract, signers.alice, testDataset, signers.bob);

      // Verify JobFinalized event is emitted
      const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

      expect(jobFinalizedEvent?.jobId).to.equal(jobId);
      expect(jobFinalizedEvent?.buyer).to.equal(signers.bob.address);

      // Verify job is closed after finalization
      expect(await jobManagerContract.jobOpen(jobId)).to.be.false;

      // Even the seller should be unable to decrypt the result
      await expect(
        fhevm.userDecryptEuint(FhevmType.euint64, jobFinalizedEvent?.result, jobManagerContractAddress, signers.alice),
      ).to.be.rejected;

      // Verify buyer can decrypt the result
      await fhevm.userDecryptEuint(
        FhevmType.euint64,
        jobFinalizedEvent?.result,
        jobManagerContractAddress,
        signers.bob,
      );

      // Attempting to finalize again should revert with JobClosed error
      await expect(jobManagerContract.connect(signers.alice).finalize(jobId)).to.be.revertedWithCustomError(
        jobManagerContract,
        "JobClosed",
      );
    });

    it("should prevent finalizing job before processing all rows", async () => {
      const countJobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      // Open a job with COUNT operation
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, countJobParams);
      const jobId = 0;

      // Push only the first row (not all rows)
      await jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0);

      // Attempting to finalize before processing all rows should revert with IncompleteProcessing error
      await expect(jobManagerContract.connect(signers.alice).finalize(jobId)).to.be.revertedWithCustomError(
        jobManagerContract,
        "IncompleteProcessing",
      );
    });
  });

  describe("computation", () => {
    it("COUNT: should count all rows when using empty filter", async () => {
      const receipt = await executeCountJob(jobManagerContract, signers.alice, testDataset, signers.bob);

      const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

      const decryptedResult = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        jobFinalizedEvent?.result,
        jobManagerContractAddress,
        signers.bob,
      );

      // Verify the decrypted count matches the number of rows pushed
      expect(decryptedResult).to.equal(BigInt(testDataset.rows.length));
    });

    it("SUM: should sum target columnn values across all rows", async () => {
      const datasetId = 2;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      const rowConfigs = [
        [
          { type: "euint8", value: 42 },
          { type: "euint8", value: 89 },
        ],
        [
          { type: "euint32", value: 1337 },
          { type: "euint32", value: 101 },
        ],
        [
          { type: "euint64", value: 999999 },
          { type: "euint64", value: 1021 },
        ],
        [
          { type: "euint8", value: 10 },
          { type: "euint8", value: 43 },
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Open jobs for each target column
      const targetColumns = [0, 1];
      const jobIds = [0, 1];
      for (let i = 0; i < targetColumns.length; i++) {
        const targetColumn = targetColumns[i];
        const sumJobParams = {
          ...createDefaultJobParams(),
          targetField: targetColumn,
          op: OpCodes.SUM,
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Open a job with SUM operation
        await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, sumJobParams);
        const jobId = jobIds[i];

        // Push all rows
        for (let i = 0; i < dataset.rows.length; i++) {
          await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
        }

        // Finalize the job - should return encrypted sum
        const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
        const receipt = await tx.wait();
        const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

        const decryptedResult = await fhevm.userDecryptEuint(
          FhevmType.euint64,
          jobFinalizedEvent?.result,
          jobManagerContractAddress,
          signers.bob,
        );

        const targetColumnTotalSum = rowConfigs.reduce((acc, row) => acc + row[targetColumn].value, 0);
        expect(decryptedResult).to.equal(BigInt(targetColumnTotalSum));
      }
    });

    it("AVG_P: should compute average of target column values using plaintext divisor", async () => {
      const datasetId = 3;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;
      const divisor = 2; // Use divisor of 2 for averaging

      const rowConfigs = [
        [
          { type: "euint8", value: 10 },
          { type: "euint8", value: 20 },
        ],
        [
          { type: "euint32", value: 30 },
          { type: "euint32", value: 40 },
        ],
        [
          { type: "euint64", value: 50 },
          { type: "euint64", value: 60 },
        ],
        [
          { type: "euint8", value: 70 },
          { type: "euint8", value: 80 },
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Open jobs for each target column
      const targetColumns = [0, 1];
      const jobIds = [0, 1];
      for (let i = 0; i < targetColumns.length; i++) {
        const targetColumn = targetColumns[i];
        const avgJobParams = {
          ...createDefaultJobParams(),
          targetField: targetColumn,
          op: OpCodes.AVG_P,
          divisor: divisor,
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Open a job with AVG_P operation
        await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, avgJobParams);
        const jobId = jobIds[i];

        // Push all rows
        for (let j = 0; j < dataset.rows.length; j++) {
          await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[j], dataset.proofs[j], j);
        }

        // Finalize the job - should return encrypted average
        const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
        const receipt = await tx.wait();
        const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

        const decryptedResult = await fhevm.userDecryptEuint(
          FhevmType.euint64,
          jobFinalizedEvent?.result,
          jobManagerContractAddress,
          signers.bob,
        );

        // Calculate expected average: sum of target column / divisor
        const targetColumnSum = rowConfigs.reduce((acc, row) => acc + row[targetColumn].value, 0);
        const expectedAverage = Math.floor(targetColumnSum / divisor); // Use floor division like Solidity
        expect(decryptedResult).to.equal(BigInt(expectedAverage));
      }
    });

    it("WEIGHTED_SUM: should compute weighted sum of specified fields", async () => {
      const datasetId = 4;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with 3 columns for weighted sum testing
      const rowConfigs = [
        [
          { type: "euint8", value: 10 }, // field 0
          { type: "euint8", value: 20 }, // field 1
          { type: "euint8", value: 30 }, // field 2
        ],
        [
          { type: "euint32", value: 15 },
          { type: "euint32", value: 25 },
          { type: "euint32", value: 35 },
        ],
        [
          { type: "euint64", value: 5 },
          { type: "euint64", value: 10 },
          { type: "euint64", value: 15 },
        ],
        [
          { type: "euint8", value: 8 },
          { type: "euint8", value: 12 },
          { type: "euint8", value: 16 },
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Test weighted sum: (field0 * 2) + (field1 * 1) + (field2 * 3)
      const weights = [2, 1, 3]; // weights for fields 0, 1, 2 respectively

      const weightedSumJobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.WEIGHTED_SUM,
        weights: weights,
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      // Open a job with WEIGHTED_SUM operation
      await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, weightedSumJobParams);
      const jobId = 0;

      // Push all rows
      for (let i = 0; i < dataset.rows.length; i++) {
        await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
      }

      // Finalize the job - should return encrypted weighted sum
      const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
      const receipt = await tx.wait();
      const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

      const decryptedResult = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        jobFinalizedEvent?.result,
        jobManagerContractAddress,
        signers.bob,
      );

      // Expected calculation:
      // Row 0: (10 * 2) + (20 * 1) + (30 * 3) = 20 + 20 + 90 = 130
      // Row 1: (15 * 2) + (25 * 1) + (35 * 3) = 30 + 25 + 105 = 160
      // Row 2: (5 * 2) + (10 * 1) + (15 * 3) = 10 + 10 + 45 = 65
      // Row 3: (8 * 2) + (12 * 1) + (16 * 3) = 16 + 12 + 48 = 76
      // Total: 130 + 160 + 65 + 76 = 431
      const expectedWeightedSum = BigInt(431);
      expect(decryptedResult).to.equal(expectedWeightedSum);
    });

    it("MIN: should find minimum value in target column", async () => {
      const datasetId = 5;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with values that have clear minimums
      const rowConfigs = [
        [
          { type: "euint8", value: 50 }, // field 0: will be max
          { type: "euint8", value: 10 }, // field 1: will be min
        ],
        [
          { type: "euint32", value: 25 }, // field 0: min so far
          { type: "euint32", value: 40 }, // field 1: not min
        ],
        [
          { type: "euint64", value: 75 }, // field 0: max so far
          { type: "euint64", value: 5 }, // field 1: new min
        ],
        [
          { type: "euint8", value: 30 }, // field 0: not min
          { type: "euint8", value: 15 }, // field 1: not min
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Test MIN operation on both columns
      const targetColumns = [0, 1];
      const expectedMins = [25, 5]; // field 0 min = 25, field 1 min = 5
      const jobIds = [0, 1];

      for (let i = 0; i < targetColumns.length; i++) {
        const targetColumn = targetColumns[i];
        const minJobParams = {
          ...createDefaultJobParams(),
          targetField: targetColumn,
          op: OpCodes.MIN,
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Open a job with MIN operation
        await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, minJobParams);
        const jobId = jobIds[i];

        // Push all rows
        for (let j = 0; j < dataset.rows.length; j++) {
          await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[j], dataset.proofs[j], j);
        }

        // Finalize the job - should return encrypted minimum
        const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
        const receipt = await tx.wait();
        const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

        const decryptedResult = await fhevm.userDecryptEuint(
          FhevmType.euint64,
          jobFinalizedEvent?.result,
          jobManagerContractAddress,
          signers.bob,
        );

        // Verify the minimum value is returned
        expect(decryptedResult).to.equal(BigInt(expectedMins[i]));
      }
    });

    it("MAX: should find maximum value in target column", async () => {
      const datasetId = 6;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with values that have clear maximums
      const rowConfigs = [
        [
          { type: "euint8", value: 50 }, // field 0: will be max
          { type: "euint8", value: 10 }, // field 1: will be min
        ],
        [
          { type: "euint32", value: 25 }, // field 0: not max
          { type: "euint32", value: 40 }, // field 1: not max
        ],
        [
          { type: "euint64", value: 75 }, // field 0: new max
          { type: "euint64", value: 5 }, // field 1: not max
        ],
        [
          { type: "euint8", value: 30 }, // field 0: not max
          { type: "euint8", value: 85 }, // field 1: new max
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Test MAX operation on both columns
      const targetColumns = [0, 1];
      const expectedMaxes = [75, 85]; // field 0 max = 75, field 1 max = 85
      const jobIds = [0, 1];

      for (let i = 0; i < targetColumns.length; i++) {
        const targetColumn = targetColumns[i];
        const maxJobParams = {
          ...createDefaultJobParams(),
          targetField: targetColumn,
          op: OpCodes.MAX,
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Open a job with MAX operation
        await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, maxJobParams);
        const jobId = jobIds[i];

        // Push all rows
        for (let j = 0; j < dataset.rows.length; j++) {
          await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[j], dataset.proofs[j], j);
        }

        // Finalize the job - should return encrypted maximum
        const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
        const receipt = await tx.wait();
        const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

        const decryptedResult = await fhevm.userDecryptEuint(
          FhevmType.euint64,
          jobFinalizedEvent?.result,
          jobManagerContractAddress,
          signers.bob,
        );

        // Verify the maximum value is returned
        expect(decryptedResult).to.equal(BigInt(expectedMaxes[i]));
      }
    });

    // it("should track last use timestamp for cooldown", async () => {
  });

  describe("filter", () => {
    it("should evaluate filter bytecode and affect COUNT result", async () => {
      const datasetId = 7;
      const dataset = createDefaultDatasetParams(datasetId);
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with known values: [5, 15, 25, 35] in first column
      // We'll filter for values > 20, which should keep only 25 and 35 (2 rows)
      const rowConfigs = [
        [
          { type: "euint8", value: 5 },
          { type: "euint8", value: 100 },
        ],
        [
          { type: "euint8", value: 15 },
          { type: "euint8", value: 200 },
        ],
        [
          { type: "euint8", value: 25 },
          { type: "euint8", value: 250 },
        ],
        [
          { type: "euint8", value: 35 },
          { type: "euint8", value: 50 },
        ],
      ] as RowConfig[][];

      const testData = await generateTestDatasetWithCustomConfig(
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      dataset.rows = testData.rows;
      dataset.merkleRoot = testData.root;
      dataset.proofs = testData.proofs;
      dataset.numColumns = testData.numColumns;
      dataset.rowCount = testData.rows.length;

      await datasetRegistryContract
        .connect(datasetOwner)
        .commitDataset(dataset.id, dataset.rowCount, dataset.merkleRoot, dataset.numColumns);

      // Create COUNT job with filter: field[0] > 20
      // Bytecode: PUSH_FIELD(0), PUSH_CONST(20), GT
      // prettier-ignore
      const filterBytecode = new Uint8Array([
        0x01, 0x00, 0x00, // PUSH_FIELD index 0 (3 bytes: opcode + 2-byte index)
        0x02, 0x00, 0x00, // PUSH_CONST index 0 (3 bytes: opcode + 2-byte index into consts array)
        0x10, // GT (1 byte)
      ]);

      const countJobWithFilterParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: ethers.hexlify(filterBytecode),
          consts: [20], // Constants array: [20]
        },
      };

      // Open job
      await jobManagerContract.connect(datasetOwner).openJob(dataset.id, jobBuyer, countJobWithFilterParams);
      const jobId = 0;

      // Push all rows
      for (let i = 0; i < dataset.rows.length; i++) {
        await jobManagerContract.connect(datasetOwner).pushRow(jobId, dataset.rows[i], dataset.proofs[i], i);
      }

      // Finalize the job
      const tx = await jobManagerContract.connect(datasetOwner).finalize(jobId);
      const receipt = await tx.wait();
      const jobFinalizedEvent = parseJobFinalizedEvent(jobManagerContract, receipt);

      // Decrypt the result
      const decryptedResult = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        jobFinalizedEvent?.result,
        jobManagerContractAddress,
        signers.bob,
      );

      // Should count only rows where field[0] > 20: values 25 and 35 (2 rows)
      expect(decryptedResult).to.equal(BigInt(2));
    });
  });
});

async function executeCountJob(
  jobManagerContract: JobManager,
  testDatasetOwner: HardhatEthersSigner,
  testDataset: TestDataset,
  buyer: HardhatEthersSigner,
) {
  const countJobParams = {
    ...createDefaultJobParams(),
    op: OpCodes.COUNT,
    filter: {
      bytecode: "0x", // Empty filter - accept all rows
      consts: [],
    },
  };

  // Open a job with COUNT operation
  await jobManagerContract.connect(testDatasetOwner).openJob(testDataset.id, buyer, countJobParams);
  const jobId = 0;

  // Push all rows
  for (let i = 0; i < testDataset.rows.length; i++) {
    await jobManagerContract.connect(testDatasetOwner).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
  }

  // Finalize the job - should return encrypted count
  const tx = await jobManagerContract.connect(testDatasetOwner).finalize(jobId);
  return await tx.wait();
}

// async function executeSumJob(
//   jobManagerContract: JobManager,
//   testDatasetOwner: HardhatEthersSigner,
//   testDataset: TestDataset,
//   buyer: HardhatEthersSigner,
// ) {
//   const sumJobParams = {
//     ...createDefaultJobParams(),
//     op: OpCodes.SUM,
//     filter: {
//       bytecode: "0x", // Empty filter - accept all rows
//       consts: [],
//     },
//   };

//   // Open a job with SUM operation
//   await jobManagerContract.connect(testDatasetOwner).openJob(testDataset.id, buyer, sumJobParams);
//   const jobId = 0;

//   // Push all rows
//   for (let i = 0; i < testDataset.rows.length; i++) {
//     await jobManagerContract.connect(testDatasetOwner).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
//   }

//   // Finalize the job - should return encrypted sum
//   const tx = await jobManagerContract.connect(testDatasetOwner).finalize(jobId);
//   return await tx.wait();
// }

function parseJobFinalizedEvent(jobManagerContract: JobManager, receipt: TransactionReceipt | null) {
  if (!receipt) {
    return undefined;
  }

  return receipt.logs.map((log) => jobManagerContract.interface.parseLog(log)).find((e) => e?.name === "JobFinalized")!
    .args;
}
