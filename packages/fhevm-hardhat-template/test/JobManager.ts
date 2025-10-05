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
  TestDataset,
  OpCodes,
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
    console.log(`JobManager has been deployed at address ${jobManagerContractAddress}`);

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
      // Open first job with dataset 1
      const jobParams1 = createDefaultJobParams();

      const testDataset2 = await setupTestDataset(datasetRegistryContract, jobManagerContractAddress, signers.alice, 2);

      // Setup test dataset

      const job1Id = 0;
      const job2Id = 1;

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

    // it("should reject pushRow for non-existent dataset", async () => {
    //   const jobParams = createDefaultJobParams();

    //   // Open job on non-existent dataset
    //   const nonExistentDatasetId = 999;
    //   await jobManagerContract.connect(signers.alice).openJob(nonExistentDatasetId, signers.bob.address, jobParams);
    //   const jobId = 0;

    //   // Try to push row - should fail
    //   const rowIndex = 0;
    //   const rowData = testDataset.rows[rowIndex]; // Now a hex string
    //   const merkleProof = testDataset.proofs[rowIndex];

    //   await expect(
    //     jobManagerContract.connect(signers.alice).pushRow(jobId, rowData, merkleProof, rowIndex),
    //   ).to.be.revertedWithCustomError(jobManagerContract, "DatasetNotFound");
    // });

    // it("should ");
    // });
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
    it("should count all rows when using COUNT operation with empty filter", async () => {
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

    // it("should track last use timestamp for cooldown", async () => {
    //   // Open job, finalize it
    //   // Verify _lastUse is updated with block.timestamp
    //   // Open another job on same dataset -> should respect cooldown
    // });
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

function parseJobFinalizedEvent(jobManagerContract: JobManager, receipt: TransactionReceipt | null) {
  if (!receipt) {
    return undefined;
  }

  return receipt.logs.map((log) => jobManagerContract.interface.parseLog(log)).find((e) => e?.name === "JobFinalized")!
    .args;
}
