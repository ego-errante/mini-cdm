import { JobManager } from "../../types";
import { DatasetRegistry } from "../../types";
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
  setupTestDatasetWithCooldown,
  generateTestDatasetWithEncryption,
  TestDataset,
  OpCodes,
  KAnonymityLevels,
  RowConfig,
  createAndRegisterDataset,
  executeJobAndDecryptResult,
  parseJobFinalizedEvent,
  encryptKAnonymity,
} from "../utils";
import {
  compileFilterDSL,
  gt,
  ge,
  lt,
  le,
  eq,
  ne,
  and,
  or,
  not,
  FilterDSL,
  OpcodeName,
  buildBytecode,
} from "../filter-dsl";

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

    // Set the JobManager address on the DatasetRegistry so commitDataset can work
    await datasetRegistryContract.connect(signers.deployer).setJobManager(jobManagerContractAddress);

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
      const nextJobId = await jobManagerContract.nextJobId();
      await expect(jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice, jobParams))
        .to.emit(jobManagerContract, "JobOpened")
        .withArgs(nextJobId, testDataset.id, signers.alice.address); // jobId should be 1 for first job

      const jobId = 1; // First job should have ID 1

      // Verify the job was properly created
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;
      expect(await jobManagerContract.nextJobId()).to.equal(nextJobId + 1n); // Should be incremented
    });

    it("should initialize job state with zero values after openJob", async () => {
      const datasetId = 1;
      const jobParams = createDefaultJobParams();

      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(datasetId, signers.alice.address, jobParams);

      // Verify dataset is stored
      expect(await jobManagerContract.jobDataset(jobId)).to.equal(datasetId);

      // Verify job buyer is set to alice
      expect(await jobManagerContract.jobBuyer(jobId)).to.equal(signers.alice.address);

      // Verify job is open
      expect(await jobManagerContract.jobOpen(jobId)).to.be.true;

      // Verify next job ID is incremented
      expect(await jobManagerContract.nextJobId()).to.equal(jobId + 1n);
    });

    it("should store different dataset IDs for different jobs", async () => {
      const testDataset2 = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice, 2);

      const job1Id = await jobManagerContract.nextJobId();
      const job2Id = job1Id + 1n;
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

    it("should reject openJob when targetField is out of bounds for operations that use it", async () => {
      const operationsWithTargetField = [OpCodes.SUM, OpCodes.AVG_P, OpCodes.MIN, OpCodes.MAX];
      const numColumns = firstDatasetColumns; // testDataset has 1 column (index 0)

      for (const op of operationsWithTargetField) {
        const jobParams = {
          ...createDefaultJobParams(),
          op: op,
          targetField: numColumns, // Out of bounds - should be < numColumns
          divisor: op === OpCodes.AVG_P ? 2 : 0, // Set divisor for AVG_P to avoid CannotDivideByZero
          filter: {
            bytecode: "0x", // Empty filter - accept all rows
            consts: [],
          },
        };

        // Alice tries to open job with invalid targetField
        await expect(
          jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice.address, jobParams),
        ).to.be.revertedWithCustomError(jobManagerContract, "InvalidFieldIndex");
      }
    });

    it("should reject openJob when clampMin > clampMax", async () => {
      const jobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.SUM,
        targetField: 0,
        clampMin: 100,
        clampMax: 50, // clampMin > clampMax should be rejected
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      // Alice tries to open job with invalid clamp range
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "InvalidClampRange");
    });

    it("should reject openJob when filter bytecode is too long", async () => {
      const maxBytecodeLength = 512;
      const oversizedBytecode = "0x" + "ff".repeat(maxBytecodeLength + 1); // 513 bytes

      const jobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: oversizedBytecode,
          consts: [],
        },
      };

      // Alice tries to open job with oversized bytecode
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterBytecodeTooLong");
    });

    it("should reject openJob when filter consts array is too long", async () => {
      const maxConstsLength = 64;
      const oversizedConsts = Array(maxConstsLength + 1).fill(0); // 65 elements

      const jobParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: oversizedConsts,
        },
      };

      // Alice tries to open job with oversized consts array
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.alice.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterConstsTooLong");
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

      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.deployer).openJob(testDataset2.id, signers.deployer.address, jobParams);

      await expect(
        jobManagerContract.connect(signers.deployer).pushRow(jobId, testDataset2.rows[0], testDataset2.proofs[0], 0),
      )
        .to.emit(jobManagerContract, "RowPushed")
        .withArgs(jobId);
    });

    it("should only accept rows in sequential ascending order", async () => {
      const jobParams = createDefaultJobParams();

      // Open job
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

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
      const jobId1 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

      // Open second job
      const jobId2 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

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
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

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
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

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

      const { handle: encryptedKAnonymity, inputProof } = await encryptKAnonymity(
        datasetRegistryContractAddress,
        signers.alice,
        KAnonymityLevels.NONE,
      );

      // Register the dataset with an incorrect schema hash (claiming it has 2 columns instead of 1)
      const wrongSchemaHash = ethers.keccak256(ethers.solidityPacked(["uint256"], [2])); // Schema for 2 columns
      await datasetRegistryContract.connect(signers.alice).commitDataset(
        2, // dataset ID
        correctRowDataset.rows.length,
        correctRowDataset.root,
        wrongSchemaHash,
        encryptedKAnonymity,
        inputProof,
        0,
      );

      const jobParams = createDefaultJobParams();

      // Open job for this dataset
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(2, signers.bob.address, jobParams);

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
      const jobId = await jobManagerContract.nextJobId();

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
        fhevm.userDecryptEuint(FhevmType.euint256, jobFinalizedEvent?.result, jobManagerContractAddress, signers.alice),
      ).to.be.rejected;

      // Verify buyer can decrypt the result
      await fhevm.userDecryptEuint(
        FhevmType.euint256,
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
      const jobId = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, countJobParams);

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
        FhevmType.euint256,
        jobFinalizedEvent?.result,
        jobManagerContractAddress,
        signers.bob,
      );

      // Verify the decrypted count matches the number of rows pushed
      expect(decryptedResult).to.equal(BigInt(testDataset.rows.length));
    });

    it("SUM: should sum target columnn values across all rows", async () => {
      const datasetId = 2;
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Test SUM operation for each target column
      const targetColumns = [0, 1];
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

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          sumJobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        const targetColumnTotalSum = rowConfigs.reduce((acc, row) => acc + row[targetColumn].value, 0);
        expect(decryptedResult).to.equal(BigInt(targetColumnTotalSum));
      }
    });

    it("AVG_P: should compute average of target column values using plaintext divisor", async () => {
      const datasetId = 3;
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Test AVG_P operation for each target column
      const targetColumns = [0, 1];
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

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          avgJobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        // Calculate expected average: sum of target column / divisor
        const targetColumnSum = rowConfigs.reduce((acc, row) => acc + row[targetColumn].value, 0);
        const expectedAverage = Math.floor(targetColumnSum / divisor); // Use floor division like Solidity
        expect(decryptedResult).to.equal(BigInt(expectedAverage));
      }
    });

    it("WEIGHTED_SUM: should compute weighted sum of specified fields", async () => {
      const datasetId = 4;
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

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

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        weightedSumJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Test MIN operation on both columns
      const targetColumns = [0, 1];
      const expectedMins = [25, 5]; // field 0 min = 25, field 1 min = 5

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

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          minJobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        // Verify the minimum value is returned
        expect(decryptedResult).to.equal(BigInt(expectedMins[i]));
      }
    });

    it("MAX: should find maximum value in target column", async () => {
      const datasetId = 6;
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Test MAX operation on both columns
      const targetColumns = [0, 1];
      const expectedMaxes = [75, 85]; // field 0 max = 75, field 1 max = 85

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

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          maxJobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        // Verify the maximum value is returned
        expect(decryptedResult).to.equal(BigInt(expectedMaxes[i]));
      }
    });

    it("CLAMP: should clamp result to minimum value when result is below clampMin", async () => {
      const datasetId = 9;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with small values that will sum to less than clampMin
      const rowConfigs = [
        [
          { type: "euint8", value: 1 },
          { type: "euint8", value: 10 },
        ],
        [
          { type: "euint8", value: 2 },
          { type: "euint8", value: 15 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const clampMinJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        clampMin: 10, // Sum should be 3, but will be clamped to 10
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        clampMinJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 1 + 2 = 3, but clamped to min of 10
      expect(decryptedResult).to.equal(BigInt(10));
    });

    it("CLAMP: should clamp result to maximum value when result is above clampMax", async () => {
      const datasetId = 10;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with large values that will sum to more than clampMax
      const rowConfigs = [
        [
          { type: "euint8", value: 50 },
          { type: "euint8", value: 100 },
        ],
        [
          { type: "euint8", value: 60 },
          { type: "euint8", value: 150 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const clampMaxJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        clampMax: 50, // Sum should be 110, but will be clamped to 50
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        clampMaxJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 50 + 60 = 110, but clamped to max of 50
      expect(decryptedResult).to.equal(BigInt(50));
    });

    it("CLAMP: should apply both clampMin and clampMax bounds", async () => {
      const datasetId = 11;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with values in normal range
      const rowConfigs = [
        [
          { type: "euint8", value: 20 },
          { type: "euint8", value: 30 },
        ],
        [
          { type: "euint8", value: 25 },
          { type: "euint8", value: 35 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const clampBothJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        clampMin: 30, // Sum should be 45, clamped to 40
        clampMax: 40,
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        clampBothJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 20 + 25 = 45, clamped to max of 40
      expect(decryptedResult).to.equal(BigInt(40));
    });

    it("ROUND: should round values near the top of bucket to bucket ceiling", async () => {
      const datasetId = 12;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset that sums to 47
      const rowConfigs = [
        [
          { type: "euint8", value: 15 },
          { type: "euint8", value: 20 },
        ],
        [
          { type: "euint8", value: 16 },
          { type: "euint8", value: 25 },
        ],
        [
          { type: "euint8", value: 16 },
          { type: "euint8", value: 30 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const roundBucketJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        roundBucket: 10, // 47 rounds to 50 (nearest multiple of 10)
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        roundBucketJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 15 + 16 + 16 = 47, rounded to nearest 10 = 50
      expect(decryptedResult).to.equal(BigInt(50));
    });

    it("ROUND: should round values near bottom of bucket to bucket floor", async () => {
      const datasetId = 15;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with small values near bottom of 10-unit buckets
      const rowConfigs = [
        [
          { type: "euint8", value: 1 }, // rounds to 0
          { type: "euint8", value: 2 }, // rounds to 0
        ],
        [
          { type: "euint8", value: 3 }, // rounds to 0
          { type: "euint8", value: 4 }, // rounds to 0
        ],
        [
          { type: "euint8", value: 6 }, // rounds to 10 (crosses midpoint)
          { type: "euint8", value: 7 }, // rounds to 10
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const roundBucketJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        roundBucket: 10, // Round to nearest 10
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        roundBucketJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 1 + 3 + 6 = 10, rounded to nearest 10 = 10
      expect(decryptedResult).to.equal(BigInt(10));
    });

    it("ROUND: should round up when result is halfway between buckets", async () => {
      const datasetId = 13;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset that sums to 25 (halfway between 20 and 30)
      const rowConfigs = [
        [
          { type: "euint8", value: 10 },
          { type: "euint8", value: 15 },
        ],
        [
          { type: "euint8", value: 15 },
          { type: "euint8", value: 20 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const roundBucketJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        roundBucket: 10, // 25 rounds up to 30 (nearest rounding)
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        roundBucketJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 10 + 15 = 25, rounded to nearest 10 = 30 (rounds up from halfway point)
      expect(decryptedResult).to.equal(BigInt(30));
    });

    it("ROUND: should handle roundBucket of 1 (no rounding)", async () => {
      const datasetId = 14;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      // Create dataset with odd sum
      const rowConfigs = [
        [
          { type: "euint8", value: 7 },
          { type: "euint8", value: 12 },
        ],
        [
          { type: "euint8", value: 8 },
          { type: "euint8", value: 13 },
        ],
      ] as RowConfig[][];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      const roundBucketJobParams = {
        ...createDefaultJobParams(),
        targetField: 0,
        op: OpCodes.SUM,
        roundBucket: 1, // No rounding
        filter: {
          bytecode: "0x", // Empty filter - accept all rows
          consts: [],
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        roundBucketJobParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Expected sum: 7 + 8 = 15, no rounding applied
      expect(decryptedResult).to.equal(BigInt(15));
    });

    // it("should track last use timestamp for cooldown", async () => {
  });

  describe("filter", () => {
    it("should evaluate filter bytecode and affect COUNT result", async () => {
      const datasetId = 7;
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

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Note: Keeping this here for reference
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

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        countJobWithFilterParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      // Should count only rows where field[0] > 20: values 25 and 35 (2 rows)
      expect(decryptedResult).to.equal(BigInt(2));
    });

    it("should correctly evaluate a complex filter with all opcodes", async () => {
      const datasetId = 8;
      const datasetOwner = signers.alice;
      const jobBuyer = signers.bob;

      const rowConfigs: RowConfig[][] = [
        // field[0], field[1]
        [
          { type: "euint32", value: 25 },
          { type: "euint32", value: 200 },
        ], // and: true, or: true -> KEEPS
        [
          { type: "euint32", value: 10 },
          { type: "euint32", value: 200 },
        ], // and: false, or: true -> KEEPS
        [
          { type: "euint32", value: 50 },
          { type: "euint32", value: 500 },
        ], // and: false, or: false -> REJECTS
        [
          { type: "euint32", value: 150 },
          { type: "euint32", value: 100 },
        ], // and: false, or: true -> KEEPS
      ];

      const dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
      );

      // Filter: ((11 <= field[0] <= 99 AND field[1] == 200) OR (field[1] != 500))
      // This is a left-associative chain of ANDs to keep stack usage low
      const andChain = and(and(and(and(and(gt(0, 10), ge(0, 11)), lt(0, 100)), le(0, 99)), eq(1, 200)), ne(1, 300));

      const notPart = not(eq(1, 500));
      const fullFilter = or(andChain, notPart);

      const compiledFilter = compileFilterDSL(fullFilter);

      const countJobWithFilterParams = {
        ...createDefaultJobParams(),
        op: OpCodes.COUNT,
        filter: {
          bytecode: compiledFilter.bytecode,
          consts: compiledFilter.consts,
        },
      };

      const { decryptedResult } = await executeJobAndDecryptResult(
        jobManagerContract,
        jobManagerContractAddress,
        dataset,
        countJobWithFilterParams,
        datasetOwner,
        jobBuyer,
        fhevm,
        FhevmType,
      );

      expect(decryptedResult).to.equal(BigInt(3));
    });
  });

  describe("Filter VM Error Handling", () => {
    it("should throw a client-side error for filters exceeding max stack depth", () => {
      // Create a right-associative filter that requires a stack depth of 9
      let deepFilter: FilterDSL = gt(0, 0);
      for (let i = 1; i < 9; i++) {
        deepFilter = and(gt(i, i), deepFilter);
      }

      const expectedError = `Filter DSL exceeds max stack depth. Required: 9, Max: 8`;
      expect(() => compileFilterDSL(deepFilter)).to.throw(expectedError);
    });

    it("should revert with 'PUSH_FIELD: insufficient bytecode'", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_FIELD with only one byte for index (should be 2 bytes)
      jobParams.filter.bytecode = "0x0100";
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterVMInsufficientBytecode");
    });

    it("should revert with 'PUSH_FIELD: invalid field index'", async () => {
      const jobParams = createDefaultJobParams();
      // Dataset has 2 columns (index 0, 1). We try to access index 2.
      jobParams.filter = compileFilterDSL(gt(2, 100), false);
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterVMInvalidFieldIndex");
    });

    it("should revert with 'PUSH_FIELD: value stack overflow'", async () => {
      const jobParams = createDefaultJobParams();
      // Push 9 values onto the value stack (max is 8)
      const instructions = Array(9).fill(["PUSH_FIELD" as OpcodeName, 0]);
      jobParams.filter.bytecode = buildBytecode(instructions);
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackOverflow")
        .withArgs("value");
    });

    it("should revert with 'PUSH_CONST: invalid const index'", async () => {
      const jobParams = createDefaultJobParams();
      // We provide 1 const, but try to access const at index 1.
      jobParams.filter = compileFilterDSL(gt(0, 100), false);
      jobParams.filter.consts = []; // Remove consts to make it invalid
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterVMInvalidConstantIndex");
    });

    it("should revert with 'Comparator: value stack underflow'", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_CONST 0, then GT (GT needs 1 value and 1 const, but we only push 1 const)
      jobParams.filter.bytecode = buildBytecode([["PUSH_CONST", 0], ["GT"]]);
      jobParams.filter.consts = [100];
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackUnderflow")
        .withArgs("value");
    });

    it("should revert with 'Comparator: const stack underflow'", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_FIELD 0, then GT (GT needs 1 value and 1 const, but we push no consts)
      jobParams.filter.bytecode = buildBytecode([["PUSH_FIELD", 0], ["GT"]]);
      jobParams.filter.consts = [];
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackUnderflow")
        .withArgs("const");
    });

    it("should revert with 'NOT: bool stack underflow'", async () => {
      const jobParams = createDefaultJobParams();
      // NOT without any preceding boolean expression
      jobParams.filter.bytecode = buildBytecode([["NOT"]]);
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackUnderflow")
        .withArgs("bool");
    });

    it("should revert with 'AND/OR: bool stack underflow'", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_FIELD 0, PUSH_CONST 0, GT (leaves 1 on bool stack), then AND (needs 2)
      const gtBytecode = compileFilterDSL(gt(0, 100), false);
      jobParams.filter.bytecode = gtBytecode.bytecode + buildBytecode([["AND"]]).slice(2); // Remove 0x prefix
      jobParams.filter.consts = gtBytecode.consts;
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackUnderflow")
        .withArgs("bool");
    });

    it("should revert with 'Unknown opcode'", async () => {
      const jobParams = createDefaultJobParams();
      jobParams.filter.bytecode = "0xff"; // Invalid opcode
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMUnknownOpcode")
        .withArgs(255);
    });

    it("should revert with 'invalid final stack state' (empty stack)", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_FIELD 0 without any boolean operations - leaves value stack non-empty
      jobParams.filter.bytecode = buildBytecode([["PUSH_FIELD", 0]]);
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterVMInvalidFinalStackState");
    });

    it("should revert with 'invalid final stack state' (too many results)", async () => {
      const jobParams = createDefaultJobParams();
      // Two comparisons against the same field: `gt(0, 10)` and `lt(0, 20)`.
      // This leaves two boolean values on the stack without a final logical operator.
      jobParams.filter.bytecode = buildBytecode([
        ["PUSH_FIELD", 0],
        ["PUSH_CONST", 0],
        ["GT"], // field[0] > 10
        ["PUSH_FIELD", 0],
        ["PUSH_CONST", 1],
        ["LT"], // field[0] < 20
      ]);
      jobParams.filter.consts = [10, 20];

      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      ).to.be.revertedWithCustomError(jobManagerContract, "FilterVMInvalidFinalStackState");
    });

    it("should revert with 'value stack not empty after execution'", async () => {
      const jobParams = createDefaultJobParams();
      // PUSH_FIELD 0 (for value stack), then a valid boolean expression `gt(0, 10)`.
      // This leaves a value on the valueStack after the boolean result is generated.
      jobParams.filter.bytecode = buildBytecode([
        ["PUSH_FIELD", 0], // This stays on value stack
        ["PUSH_FIELD", 0],
        ["PUSH_CONST", 0],
        ["GT"], // This creates boolean result
      ]);
      jobParams.filter.consts = [10];

      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);
      const jobId = (await jobManagerContract.nextJobId()) - 1n;
      await expect(
        jobManagerContract.connect(signers.alice).pushRow(jobId, testDataset.rows[0], testDataset.proofs[0], 0),
      )
        .to.be.revertedWithCustomError(jobManagerContract, "FilterVMStackNotEmpty")
        .withArgs("value");
    });
  });

  describe("cooldown", () => {
    it("should enforce cooldownSec between jobs for same buyer-dataset pair", async () => {
      const cooldownSec = 10; // 10 seconds cooldown
      const testDataset = await setupTestDatasetWithCooldown(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        100, // dataset ID
        cooldownSec,
      );

      const jobParams = createDefaultJobParams();

      // Open and execute first job
      const jobId1 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

      // Push all rows and finalize first job
      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(signers.alice).pushRow(jobId1, testDataset.rows[i], testDataset.proofs[i], i);
      }
      await jobManagerContract.connect(signers.alice).finalize(jobId1);

      // Immediately try to open second job - should fail due to cooldown
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams),
      ).to.be.revertedWithCustomError(jobManagerContract, "CooldownActive");
    });

    it("should allow different buyers to run jobs on same dataset without cooldown", async () => {
      const cooldownSec = 10;
      const testDataset = await setupTestDatasetWithCooldown(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        101, // dataset ID
        cooldownSec,
      );

      const jobParams = createDefaultJobParams();

      // Bob runs first job
      const jobId1 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(signers.alice).pushRow(jobId1, testDataset.rows[i], testDataset.proofs[i], i);
      }
      await jobManagerContract.connect(signers.alice).finalize(jobId1);

      // Alice (different buyer) should be able to open job immediately on same dataset
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.deployer.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");
    });

    it("should allow same buyer to run jobs on different datasets without cooldown", async () => {
      const cooldownSec = 10;

      const testDataset1 = await setupTestDatasetWithCooldown(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        102, // dataset ID 1
        cooldownSec,
      );

      const testDataset2 = await setupTestDatasetWithCooldown(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        103, // dataset ID 2
        cooldownSec,
      );

      const jobParams = createDefaultJobParams();

      // Bob runs job on first dataset
      const jobId1 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset1.id, signers.bob.address, jobParams);

      for (let i = 0; i < testDataset1.rows.length; i++) {
        await jobManagerContract
          .connect(signers.alice)
          .pushRow(jobId1, testDataset1.rows[i], testDataset1.proofs[i], i);
      }
      await jobManagerContract.connect(signers.alice).finalize(jobId1);

      // Same buyer should be able to open job on different dataset immediately
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset2.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");
    });

    it("should allow jobs after cooldown period has passed", async () => {
      const cooldownSec = 5; // Short cooldown for testing
      const testDataset = await setupTestDatasetWithCooldown(
        datasetRegistryContract,
        jobManagerContractAddress,
        signers.alice,
        104, // dataset ID
        cooldownSec,
      );

      const jobParams = createDefaultJobParams();

      // Open and execute first job
      const jobId1 = await jobManagerContract.nextJobId();
      await jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams);

      for (let i = 0; i < testDataset.rows.length; i++) {
        await jobManagerContract.connect(signers.alice).pushRow(jobId1, testDataset.rows[i], testDataset.proofs[i], i);
      }
      await jobManagerContract.connect(signers.alice).finalize(jobId1);

      // Fast forward time past the cooldown period
      await ethers.provider.send("evm_increaseTime", [cooldownSec + 1]);
      await ethers.provider.send("evm_mine");

      // Now open second job - should succeed
      await expect(
        jobManagerContract.connect(signers.alice).openJob(testDataset.id, signers.bob.address, jobParams),
      ).to.emit(jobManagerContract, "JobOpened");
    });
  });

  describe("k-anonymity", () => {
    const datasetId = 20;
    let datasetOwner: HardhatEthersSigner;
    let jobBuyer: HardhatEthersSigner;
    const kAnonymityLevel = KAnonymityLevels.MINIMAL;
    let dataset: TestDataset;

    beforeEach(async () => {
      datasetOwner = signers.alice;
      jobBuyer = signers.bob;

      // Dataset with 5 rows.
      const rowConfigs: RowConfig[][] = [
        [
          { type: "euint32", value: 10 },
          { type: "euint32", value: 100 },
        ], // row 0
        [
          { type: "euint32", value: 20 },
          { type: "euint32", value: 200 },
        ], // row 1
        [
          { type: "euint32", value: 30 },
          { type: "euint32", value: 300 },
        ], // row 2
        [
          { type: "euint32", value: 40 },
          { type: "euint32", value: 400 },
        ], // row 3
        [
          { type: "euint32", value: 50 },
          { type: "euint32", value: 500 },
        ], // row 4
      ];

      dataset = await createAndRegisterDataset(
        datasetRegistryContract,
        jobManagerContractAddress,
        datasetOwner,
        rowConfigs,
        datasetId,
        kAnonymityLevel,
      );
    });

    it("should return correct result when k-anonymity is met across all operations", async () => {
      const filterMet = gt(0, 10); // field[0] > 10, keeps 4 rows (>= k)
      const compiledFilterMet = compileFilterDSL(filterMet);

      const operations = [
        { name: "COUNT", op: OpCodes.COUNT, params: {}, expected: 4n },
        { name: "SUM", op: OpCodes.SUM, params: { targetField: 0 }, expected: 140n },
        { name: "AVG_P", op: OpCodes.AVG_P, params: { targetField: 0, divisor: 4 }, expected: 35n },
        { name: "WEIGHTED_SUM", op: OpCodes.WEIGHTED_SUM, params: { weights: [2, 3] }, expected: 4480n },
        { name: "MIN", op: OpCodes.MIN, params: { targetField: 0 }, expected: 20n },
        { name: "MAX", op: OpCodes.MAX, params: { targetField: 0 }, expected: 50n },
      ];

      for (const opInfo of operations) {
        const jobParams = {
          ...createDefaultJobParams(),
          op: opInfo.op,
          filter: compiledFilterMet,
          ...opInfo.params,
        };

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          jobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        expect(decryptedResult, `Incorrect result for ${opInfo.name}`).to.equal(opInfo.expected);
      }
    });

    it("should return sentinel value when k-anonymity is not met across all operations", async () => {
      const filterNotMet = gt(0, 40); // field[0] > 40, keeps 1 row (< k)
      const compiledFilterNotMet = compileFilterDSL(filterNotMet);

      const operations = [
        { name: "COUNT", op: OpCodes.COUNT, params: {} },
        { name: "SUM", op: OpCodes.SUM, params: { targetField: 0 } },
        { name: "AVG_P", op: OpCodes.AVG_P, params: { targetField: 0, divisor: 1 } },
        { name: "WEIGHTED_SUM", op: OpCodes.WEIGHTED_SUM, params: { weights: [2, 3] } },
        { name: "MIN", op: OpCodes.MIN, params: { targetField: 0 } },
        { name: "MAX", op: OpCodes.MAX, params: { targetField: 0 } },
      ];

      for (const opInfo of operations) {
        const jobParams = {
          ...createDefaultJobParams(),
          op: opInfo.op,
          filter: compiledFilterNotMet,
          ...opInfo.params,
        };

        const { decryptedResult } = await executeJobAndDecryptResult(
          jobManagerContract,
          jobManagerContractAddress,
          dataset,
          jobParams,
          datasetOwner,
          jobBuyer,
          fhevm,
          FhevmType,
        );

        // When k-anonymity is not met, contract returns uint128.max as sentinel value
        const uint128Max = BigInt(2) ** BigInt(128) - BigInt(1);
        expect(decryptedResult, `Incorrect result for ${opInfo.name}`).to.equal(uint128Max);
      }
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
  const jobId = await jobManagerContract.nextJobId();
  await jobManagerContract.connect(testDatasetOwner).openJob(testDataset.id, buyer, countJobParams);

  // Push all rows
  for (let i = 0; i < testDataset.rows.length; i++) {
    await jobManagerContract.connect(testDatasetOwner).pushRow(jobId, testDataset.rows[i], testDataset.proofs[i], i);
  }

  // Finalize the job - should return encrypted count
  const tx = await jobManagerContract.connect(testDatasetOwner).finalize(jobId);
  return await tx.wait();
}
