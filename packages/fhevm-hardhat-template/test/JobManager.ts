import { IJobManager, IJobManager__factory, JobManager, JobManager__factory } from "../types";
import { DatasetRegistry, DatasetRegistry__factory } from "../types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  generateTestDatasetWithEncryption,
  createDefaultJobParams,
  Signers,
  deployDatasetRegistryFixture,
  deployJobManagerFixture,
  generateMerkleTreeFromRows,
} from "./utils";

function createDefaultDatasetParams() {
  return {
    id: 1,
    rows: [] as string[], // Will be populated with encrypted hex strings
    merkleRoot: "0x" as string,
    proofs: [] as string[][],
    schemaHash: ethers.keccak256(ethers.toUtf8Bytes("test_schema")),
    rowCount: 4,
  };
}

describe("JobManager", function () {
  let signers: Signers;
  let jobManagerContract: JobManager;
  let jobManagerContractAddress: string;
  let datasetRegistryContract: DatasetRegistry;
  let datasetRegistryContractAddress: string;

  // Test dataset
  const testDataset = createDefaultDatasetParams();

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async () => {
    // Deploy a new instance of the contract before each test
    ({ datasetRegistryContract, datasetRegistryContractAddress } = await deployDatasetRegistryFixture());
    ({ jobManagerContract, jobManagerContractAddress: jobManagerContractAddress } =
      await deployJobManagerFixture(datasetRegistryContractAddress));

    const testData = await generateTestDatasetWithEncryption(jobManagerContractAddress, signers.alice);
    testDataset.rows = testData.rows;
    testDataset.merkleRoot = testData.root;
    testDataset.proofs = testData.proofs;
    testDataset.schemaHash = testData.schemaHash;

    // Setup test dataset
    await datasetRegistryContract
      .connect(signers.alice)
      .commitDataset(testDataset.id, testDataset.rowCount, testDataset.merkleRoot, testDataset.schemaHash);
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

      const testDataset2 = createDefaultDatasetParams();
      const testData2 = await generateTestDatasetWithEncryption(jobManagerContractAddress, signers.alice);
      testDataset2.id = 2;
      testDataset2.rows = testData2.rows;
      testDataset2.merkleRoot = testData2.root;
      testDataset2.proofs = testData2.proofs;
      testDataset2.schemaHash = testData2.schemaHash;

      // Setup test dataset
      await datasetRegistryContract
        .connect(signers.alice)
        .commitDataset(testDataset2.id, testDataset2.rowCount, testDataset2.merkleRoot, testDataset2.schemaHash);

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
      // Create test dataset with proper merkle tree
      const testDataset2 = createDefaultDatasetParams();
      const testData2 = await generateTestDatasetWithEncryption(jobManagerContractAddress, signers.deployer);
      testDataset2.id = 2;
      testDataset2.rows = testData2.rows;
      testDataset2.merkleRoot = testData2.root;
      testDataset2.proofs = testData2.proofs;
      testDataset2.schemaHash = testData2.schemaHash;

      await datasetRegistryContract
        .connect(signers.deployer)
        .commitDataset(testDataset2.id, testDataset2.rowCount, testDataset2.merkleRoot, testDataset2.schemaHash);

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
    it("should emit JobFinalized event when finalizing a job", async () => {
      // First create a dataset in registry
      const datasetId = 1;
      const testRows = ["0x" + Buffer.from("test_row_data").toString("hex")]; // Convert to hex strings
      const testData = await generateMerkleTreeFromRows(testRows, datasetId);
      const schemaHash = ethers.keccak256(ethers.toUtf8Bytes("test_schema"));

      await datasetRegistryContract
        .connect(signers.deployer)
        .commitDataset(datasetId, testRows.length, testData.root, schemaHash);

      // Open a job
      const jobParams = createDefaultJobParams();

      await jobManagerContract.connect(signers.deployer).openJob(datasetId, signers.deployer.address, jobParams);
      const jobId = 0;

      // Finalize the job and expect JobFinalized event
      await expect(jobManagerContract.connect(signers.deployer).finalize(jobId))
        .to.emit(jobManagerContract, "JobFinalized")
        .withArgs(jobId, signers.deployer.address);

      // Verify job is closed after finalization
      expect(await jobManagerContract.jobOpen(jobId)).to.be.false;
    });
  });

  // it("should track last use timestamp for cooldown", async () => {
  //   // Open job, finalize it
  //   // Verify _lastUse is updated with block.timestamp
  //   // Open another job on same dataset -> should respect cooldown
  // });
});
